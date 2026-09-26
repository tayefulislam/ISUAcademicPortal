import fs from 'node:fs/promises';
import path from 'node:path';
import { detectBinary } from './signatures.js';
import {
  categoryForExtension,
  categoryForMime,
  isAlreadyCompressed,
  isTextLike,
} from './categories.js';

/**
 * The single entry point for "what is this file, really?".
 *
 * Combines three evidence sources, in order of trust:
 *   1. magic bytes (authoritative — see signatures.js)
 *   2. container inspection (a zip is a .docx/.xlsx/.pptx/.odt; needs the
 *      local file headers, so a larger header is read for PK files)
 *   3. content sniffing (SVG / JSON / CSV / RTF / plain text)
 *
 * The client's MIME and the filename extension are recorded for the
 * "mismatch" flag but NEVER decide the outcome. §3 and §17 of the spec both
 * require this: `isAllowedUploadMime`-style extension checks are exactly the
 * hole being closed.
 */

// Enough to cover every signature above plus a zip's first local file
// headers and `[Content_Types].xml`, which appear near the start.
export const HEADER_BYTES = 65536;

function extensionOf(name) {
  const base = path.basename(String(name || ''));
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return '';
  return base.slice(idx + 1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Zip container refinement: a PK file is a zip, but it may be a document.
// ---------------------------------------------------------------------------

const ZIP_MARKERS = [
  // The OOXML package parts. `word/document.xml` etc. appear as local file
  // header names in the first entries, so the header buffer is enough.
  { needles: ['word/document.xml', 'word/'], ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word document' },
  { needles: ['xl/workbook.xml', 'xl/'], ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel workbook' },
  { needles: ['ppt/presentation.xml', 'ppt/'], ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint presentation' },
  // OpenDocument
  { needles: ['application/vnd.oasis.opendocument.text'], ext: 'odt', mime: 'application/vnd.oasis.opendocument.text', label: 'OpenDocument text' },
  { needles: ['application/vnd.oasis.opendocument.spreadsheet'], ext: 'ods', mime: 'application/vnd.oasis.opendocument.spreadsheet', label: 'OpenDocument spreadsheet' },
  { needles: ['application/vnd.oasis.opendocument.presentation'], ext: 'odp', mime: 'application/vnd.oasis.opendocument.presentation', label: 'OpenDocument presentation' },
  // E-book / JAR are still archives, just named ones.
  { needles: ['application/epub+zip'], ext: 'epub', mime: 'application/epub+zip', label: 'EPUB e-book' },
  { needles: ['META-INF/MANIFEST.MF'], ext: 'jar', mime: 'application/java-archive', label: 'Java archive' },
];

function refineZip(buf) {
  const hay = buf.toString('latin1');
  for (const marker of ZIP_MARKERS) {
    if (marker.needles.some((n) => hay.includes(n))) {
      return { ext: marker.ext, mime: marker.mime, label: marker.label };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Text sniffing (only reached when magic bytes found nothing).
// ---------------------------------------------------------------------------

function looksLikeText(buf) {
  if (!buf.length) return false;
  // A NUL byte in the first block means binary, essentially without exception.
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  let suspicious = 0;
  for (const byte of sample) {
    // Allow tab / LF / CR / FF / ESC and everything printable.
    if (byte === 0x00) return false;
    const printable = byte >= 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d || byte === 0x0c || byte === 0x1b;
    if (!printable) suspicious += 1;
  }
  return suspicious / sample.length < 0.05;
}

function countDelimiter(line, delimiter) {
  let count = 0;
  for (const ch of line) if (ch === delimiter) count += 1;
  return count;
}

/**
 * Detects a delimiter-separated table. Requires at least two lines with the
 * SAME field count — a single line with commas is prose, not a CSV.
 */
function sniffCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length).slice(0, 20);
  if (lines.length < 2) return false;
  for (const delimiter of [',', '\t', ';', '|']) {
    const counts = lines.map((l) => countDelimiter(l, delimiter));
    const first = counts[0];
    if (first >= 1 && counts.every((c) => c === first)) {
      return delimiter === '\t' ? 'tsv' : 'csv';
    }
  }
  return false;
}

function sniffText(buf) {
  if (!looksLikeText(buf)) return null;
  // Decode a bounded prefix (the buffer may end mid-sequence).
  const text = buf.toString('utf8');
  const trimmed = text.replace(/^\uFEFF/, '').trimStart();

  if (trimmed.startsWith('{\\rtf')) {
    return { ext: 'rtf', mime: 'application/rtf', label: 'Rich Text Format' };
  }
  // SVG before generic XML: it is XML that draws.
  if (/<svg[\s>]/i.test(text.slice(0, 4096))) {
    return { ext: 'svg', mime: 'image/svg+xml', label: 'SVG image' };
  }
  if (trimmed.startsWith('<?xml')) {
    return { ext: 'xml', mime: 'application/xml', label: 'XML document' };
  }
  if (/^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    return { ext: 'html', mime: 'text/html', label: 'HTML document' };
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    // A complete parse is ideal; a truncated buffer that still shows the
    // key/value shape is good enough to call it JSON.
    try {
      JSON.parse(text);
      return { ext: 'json', mime: 'application/json', label: 'JSON document' };
    } catch {
      if (/"[^"]*"\s*:/.test(text.slice(0, 4096))) {
        return { ext: 'json', mime: 'application/json', label: 'JSON document' };
      }
    }
  }
  const delimited = sniffCsv(text);
  if (delimited === 'csv') return { ext: 'csv', mime: 'text/csv', label: 'CSV spreadsheet' };
  if (delimited === 'tsv') return { ext: 'tsv', mime: 'text/tab-separated-values', label: 'TSV spreadsheet' };

  return { ext: 'txt', mime: 'text/plain', label: 'Plain text' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * @param {Buffer} header the first HEADER_BYTES (or fewer) of the file
 * @param {{originalName?:string, clientMime?:string}} [opts]
 * @returns {{
 *   ext:string, mime:string, label:string, category:string,
 *   detected:boolean, source:'magic'|'container'|'text'|'fallback',
 *   alreadyCompressed:boolean, textLike:boolean, dangerous:boolean,
 *   clientMime:string, clientExt:string, mismatch:boolean, declaredMime:string
 * }}
 */
export function detectFileType(header, opts = {}) {
  const clientMime = String(opts.clientMime || '').toLowerCase().trim();
  const clientExt = extensionOf(opts.originalName);

  let found = null;
  let source = 'fallback';

  const binary = detectBinary(header);
  if (binary) {
    if (binary.zip) {
      const refined = refineZip(header);
      if (refined) {
        found = refined;
        source = 'container';
      } else {
        found = binary;
        source = 'magic';
      }
    } else {
      found = binary;
      source = 'magic';
    }
  } else {
    const text = sniffText(header);
    if (text) {
      found = text;
      source = 'text';
    }
  }

  if (!found) {
    // Nothing matched: an unrecognized binary. Keep whatever the extension
    // claims ONLY as the label, never as proof — the category is 'other' and
    // an unknown binary is never optimized.
    found = { ext: clientExt || '', mime: clientMime || 'application/octet-stream', label: 'Unrecognized file' };
    source = 'fallback';
  }

  const ext = found.ext || clientExt || '';
  const mime = found.mime || clientMime || 'application/octet-stream';

  // The client's hints are consulted ONLY when detection found nothing at all
  // (source === 'fallback'). If the bytes told us what this is — even if that
  // is an unfamiliar format — a lying Content-Type/extension must not be
  // allowed to move the file into a different category and thereby pick up a
  // larger size limit or a different access policy.
  const category =
    categoryForExtension(ext) ||
    categoryForMime(mime) ||
    (source === 'fallback' ? categoryForMime(clientMime) || categoryForExtension(clientExt) : null) ||
    'other';

  // A declared MIME that disagrees with what the bytes say (or an extension
  // that would categorize the file differently) is worth recording: it is how
  // a "rename .exe to .pdf" attempt shows up.
  const declaredCategory = categoryForMime(clientMime) || categoryForExtension(clientExt);
  const mismatch =
    (!!clientMime && clientMime !== 'application/octet-stream' && clientMime !== mime) ||
    (!!declaredCategory && declaredCategory !== category);

  return {
    ext,
    mime,
    label: found.label,
    category,
    detected: source === 'magic' || source === 'container' || source === 'text',
    source,
    alreadyCompressed: isAlreadyCompressed(ext, mime),
    textLike: isTextLike(ext, mime),
    dangerous: Boolean(found.dangerous),
    clientMime,
    clientExt,
    declaredMime: clientMime,
    mismatch,
  };
}

/** Reads just the header of a file from disk (bounded, so a 5 GB file is fine). */
export async function readHeader(filePath, bytes = HEADER_BYTES) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buf = Buffer.allocUnsafe(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Convenience for the worker: detect from a path on disk. */
export async function detectFileTypeFromPath(filePath, opts = {}) {
  const header = await readHeader(filePath);
  return detectFileType(header, opts);
}

export { extensionOf };
export default { detectFileType, detectFileTypeFromPath, readHeader, extensionOf, HEADER_BYTES };
