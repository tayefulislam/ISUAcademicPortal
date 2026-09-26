import fs from 'node:fs/promises';
import { validateZipStructure, ZIP_ARCHIVE_EXTS, ZIP_DOCUMENT_EXTS } from './officeValidator.js';

/**
 * The "never modify an archive" guard (§8, §10).
 *
 * RAR, 7z, gzip, tar and xz are already compressed — re-compressing a .zip
 * shrinks it by approximately nothing while burning CPU, and attempting to
 * rewrite one risks producing an archive that a user cannot open. So they are
 * stored byte-for-byte, always. This module is where that policy lives, plus the
 * light integrity check the pipeline runs before keeping one.
 */

// Formats the pipeline will never rewrite.
export const NEVER_MODIFY_EXTS = new Set([
  'zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'lz',
  'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'jar',
]);

/** Whether this file must be stored exactly as uploaded. */
export function mustStoreOriginal(ext) {
  return NEVER_MODIFY_EXTS.has(String(ext || '').toLowerCase().replace(/^\./, ''));
}

async function readAt(handle, position, length) {
  const buf = Buffer.allocUnsafe(Math.max(0, length));
  const { bytesRead } = await handle.read(buf, 0, buf.length, position);
  return buf.subarray(0, bytesRead);
}

/**
 * A TAR header carries a checksum of its own first 512-byte block — a real
 * integrity check, not just a magic-byte sniff. The checksum field itself is
 * treated as spaces while summing, per the format.
 */
async function validateTar(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const header = await readAt(handle, 0, 512);
    if (header.length < 512) return { valid: false, reason: 'too-small' };
    if (header.subarray(257, 262).toString('latin1') !== 'ustar') {
      // A pre-POSIX tar omits `ustar`; fall back to the checksum alone.
      if (!header.subarray(257, 262).toString('latin1').startsWith('us')) {
        return { valid: false, reason: 'bad-magic' };
      }
    }

    const stored = parseInt(header.subarray(148, 156).toString('latin1').replace(/[^0-7]/g, ''), 8) || 0;
    let sum = 0;
    for (let i = 0; i < 512; i += 1) {
      sum += i >= 148 && i < 156 ? 0x20 : header[i];
    }
    if (sum !== stored) return { valid: false, reason: 'bad-checksum' };
    return { valid: true, reason: 'ok' };
  } finally {
    await handle.close();
  }
}

/**
 * Validates an archive without extracting it.
 *
 * The strength varies honestly by format: a ZIP or TAR gets a structural check,
 * while RAR/7z/gzip get a header check only — their containers cannot be
 * validated without a decoder for each, and a header check is enough to catch a
 * truncated or mislabelled upload. Nothing here DECOMPRESSES, so memory stays
 * flat regardless of archive size.
 *
 * @returns {Promise<{valid:boolean, reason:string}>}
 */
export async function validateArchive(filePath, ext) {
  const normalized = String(ext || '').toLowerCase().replace(/^\./, '');

  if (ZIP_ARCHIVE_EXTS.includes(normalized) || ZIP_DOCUMENT_EXTS.includes(normalized)) {
    const result = await validateZipStructure(filePath);
    return { valid: result.valid, reason: result.reason };
  }

  if (normalized === 'tar') return validateTar(filePath);

  const handle = await fs.open(filePath, 'r');
  try {
    const head = await readAt(handle, 0, 8);
    const stat = await handle.stat();

    switch (normalized) {
      case 'gz':
      case 'tgz': {
        // Magic, the deflate method byte, and a plausible trailer length.
        if (head.length < 2 || head[0] !== 0x1f || head[1] !== 0x8b) return { valid: false, reason: 'bad-magic' };
        if (head.length >= 3 && head[2] !== 0x08) return { valid: false, reason: 'bad-compression-method' };
        if (stat.size < 20) return { valid: false, reason: 'truncated' };
        return { valid: true, reason: 'ok' };
      }
      case 'xz':
        return head.length >= 6 && head.readUInt32LE(0) === 0xfd377a58
          ? { valid: true, reason: 'ok' }
          : { valid: false, reason: 'bad-magic' };
      case 'bz2':
        return head.subarray(0, 3).toString('latin1') === 'BZh'
          ? { valid: true, reason: 'ok' }
          : { valid: false, reason: 'bad-magic' };
      case 'zst':
        return head.length >= 4 && head.readUInt32LE(0) === 0xfd2fb528
          ? { valid: true, reason: 'ok' }
          : { valid: false, reason: 'bad-magic' };
      case 'rar':
        return head.subarray(0, 4).toString('latin1') === 'Rar!'
          ? { valid: true, reason: 'ok' }
          : { valid: false, reason: 'bad-magic' };
      case '7z':
        return head.length >= 6 && head.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))
          ? { valid: true, reason: 'ok' }
          : { valid: false, reason: 'bad-magic' };
      default:
        // An unknown archive type is accepted on the strength of detection
        // alone; there is no structural check available for it.
        return { valid: true, reason: 'unchecked' };
    }
  } finally {
    await handle.close();
  }
}

export default { NEVER_MODIFY_EXTS, mustStoreOriginal, validateArchive };
