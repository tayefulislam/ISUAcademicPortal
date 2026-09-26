import fs from 'node:fs/promises';

/**
 * Integrity validation for ZIP-container documents (§10, §12 of the spec):
 * DOCX, XLSX, PPTX, ODT/ODS/ODP, and plain ZIP.
 *
 * These formats are only ever STORED, never rewritten — so this is not a
 * post-optimization check; it is a pre-STORE check that the package we are
 * about to keep is actually well-formed, and it is what lets the pipeline say
 * "this .docx is really a .docx" after detection has only seen its first bytes.
 *
 * Implemented directly on the ZIP format rather than through a zip library.
 * Two reasons: (1) validating must not mean DECOMPRESSING — `unzipSync` on a
 * 200 MB .docx would balloon memory for no benefit, whereas the central
 * directory is a small structure at the END of the file, so a few KB of reads
 * suffice; (2) it keeps a self-contained, dependency-free integrity check whose
 * rules are visible rather than delegated.
 *
 * The checks are structural: the archive ends with a valid End Of Central
 * Directory, the central directory parses, every entry's local header offset is
 * inside the file, and the parts a given document type requires are present.
 */

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64_EOCD_SIG = 0x06064b50;
const ZIP64_LOCATOR_SIG = 0x07064b50;

// The EOCD is at the very end, after a comment of at most 65535 bytes.
const EOCD_SEARCH_BYTES = 65536 + 22;

// Required package parts, per document type. A .docx missing word/document.xml
// is a corrupt file no matter how well the zip itself parses.
const REQUIRED_PARTS = {
  docx: ['[Content_Types].xml', 'word/document.xml'],
  xlsx: ['[Content_Types].xml', 'xl/workbook.xml'],
  pptx: ['[Content_Types].xml', 'ppt/presentation.xml'],
  odt: ['mimetype', 'META-INF/manifest.xml'],
  ods: ['mimetype', 'META-INF/manifest.xml'],
  odp: ['mimetype', 'META-INF/manifest.xml'],
};

async function readAt(handle, position, length) {
  const size = Math.max(0, length);
  const buf = Buffer.allocUnsafe(size);
  const { bytesRead } = await handle.read(buf, 0, size, position);
  return buf.subarray(0, bytesRead);
}

/** Scans backwards for the EOCD signature and returns its offset, or -1. */
function findEocd(tail, tailStart, fileSize) {
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      const commentLength = tail.readUInt16LE(i + 20);
      // The comment length must account for exactly the remaining bytes —
      // otherwise this is a coincidental signature inside compressed data.
      if (tailStart + i + 22 + commentLength === fileSize) return i;
    }
  }
  return -1;
}

/**
 * Parses and checks the ZIP structure.
 *
 * @returns {Promise<{valid:boolean, reason:string, entryCount:number, names:string[], zip64:boolean}>}
 */
export async function validateZipStructure(filePath) {
  const stat = await fs.stat(filePath);
  const fileSize = stat.size;
  if (fileSize < 22) {
    return { valid: false, reason: 'too-small', entryCount: 0, names: [], zip64: false };
  }

  const handle = await fs.open(filePath, 'r');
  try {
    const tailStart = Math.max(0, fileSize - EOCD_SEARCH_BYTES);
    const tail = await readAt(handle, tailStart, fileSize - tailStart);
    const eocd = findEocd(tail, tailStart, fileSize);
    if (eocd < 0) {
      return { valid: false, reason: 'no-eocd', entryCount: 0, names: [], zip64: false };
    }

    let entryCount = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    let zip64 = false;

    // ZIP64: the 32-bit fields are saturated, and the real values live in a
    // separate record pointed at by a locator just before the EOCD.
    if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      zip64 = true;
      const locatorOffset = tailStart + eocd - 20;
      if (locatorOffset >= 0) {
        const locator = await readAt(handle, locatorOffset, 20);
        if (locator.length === 20 && locator.readUInt32LE(0) === ZIP64_LOCATOR_SIG) {
          const z64Offset = Number(locator.readBigUInt64LE(8));
          const z64 = await readAt(handle, z64Offset, 56);
          if (z64.length >= 56 && z64.readUInt32LE(0) === ZIP64_EOCD_SIG) {
            entryCount = Number(z64.readBigUInt64LE(32));
            cdSize = Number(z64.readBigUInt64LE(40));
            cdOffset = Number(z64.readBigUInt64LE(48));
          }
        }
      }
      // If the ZIP64 records could not be read, fall back to a loose check
      // below rather than declaring a valid archive corrupt.
      if (cdOffset === 0xffffffff) {
        const local = await readAt(handle, 0, 4);
        const ok = local.length === 4 && local.readUInt32LE(0) === LOCAL_SIG;
        return { valid: ok, reason: ok ? 'zip64-loose' : 'bad-local-header', entryCount: 0, names: [], zip64: true };
      }
    }

    if (cdOffset + cdSize > fileSize) {
      return { valid: false, reason: 'central-directory-out-of-bounds', entryCount: 0, names: [], zip64 };
    }

    const cd = await readAt(handle, cdOffset, cdSize);
    const names = [];
    let cursor = 0;

    for (let i = 0; i < entryCount; i += 1) {
      if (cursor + 46 > cd.length) {
        return { valid: false, reason: 'truncated-central-directory', entryCount: names.length, names, zip64 };
      }
      if (cd.readUInt32LE(cursor) !== CD_SIG) {
        return { valid: false, reason: 'bad-central-directory-entry', entryCount: names.length, names, zip64 };
      }

      const nameLength = cd.readUInt16LE(cursor + 28);
      const extraLength = cd.readUInt16LE(cursor + 30);
      const commentLength = cd.readUInt16LE(cursor + 32);
      const localOffset = cd.readUInt32LE(cursor + 42);

      if (cursor + 46 + nameLength > cd.length) {
        return { valid: false, reason: 'truncated-entry-name', entryCount: names.length, names, zip64 };
      }
      names.push(cd.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'));

      // The entry must actually live inside the file.
      if (localOffset + 30 > fileSize) {
        return { valid: false, reason: 'entry-offset-out-of-bounds', entryCount: names.length, names, zip64 };
      }

      cursor += 46 + nameLength + extraLength + commentLength;
    }

    return { valid: true, reason: 'ok', entryCount: names.length, names, zip64 };
  } finally {
    await handle.close();
  }
}

/**
 * Validates a ZIP-container document, additionally requiring the parts its type
 * needs.
 *
 * @param {string} filePath
 * @param {string} ext e.g. 'docx'
 * @returns {Promise<{valid:boolean, reason:string, entryCount:number}>}
 */
export async function validateDocumentPackage(filePath, ext) {
  const normalized = String(ext || '').toLowerCase().replace(/^\./, '');
  const structure = await validateZipStructure(filePath);

  if (!structure.valid) {
    return { valid: false, reason: structure.reason, entryCount: structure.entryCount };
  }

  const required = REQUIRED_PARTS[normalized];
  if (required) {
    const present = new Set(structure.names.map((n) => n.replace(/\\/g, '/')));
    const missing = required.filter((part) => !present.has(part));
    if (missing.length) {
      return { valid: false, reason: `missing-parts:${missing.join(',')}`, entryCount: structure.entryCount };
    }
  }

  return { valid: true, reason: 'ok', entryCount: structure.entryCount };
}

/** The extensions this module knows how to check. */
export const ZIP_DOCUMENT_EXTS = Object.keys(REQUIRED_PARTS);
export const ZIP_ARCHIVE_EXTS = ['zip', 'jar', 'epub'];

export default { validateZipStructure, validateDocumentPackage, ZIP_DOCUMENT_EXTS, ZIP_ARCHIVE_EXTS };
