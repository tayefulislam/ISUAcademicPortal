/**
 * Magic-byte detection. This is the authority on what a file ACTUALLY is —
 * never the client's `Content-Type`, never the filename extension. §3 of the
 * spec is explicit that both are untrusted, and both are trivially spoofed.
 *
 * Implemented as an ordered table of pure predicates over a header buffer
 * (a few KB is plenty; every signature here lives in the first 512 bytes except
 * TAR's `ustar` at offset 257). No dependency, so it is deterministic and
 * directly unit-testable with hand-built buffers.
 *
 * Container formats that need a second look (a zip could be a .docx; MKV and
 * WebM share the EBML header; MP4/MOV/M4A share `ftyp`) are disambiguated here
 * where the header alone is enough, and handed to detectFileType.js where the
 * full buffer is needed.
 */

function at(buf, offset, str) {
  if (!buf || buf.length < offset + str.length) return false;
  for (let i = 0; i < str.length; i += 1) {
    if (buf[offset + i] !== str.charCodeAt(i)) return false;
  }
  return true;
}

function bytesAt(buf, offset, arr) {
  if (!buf || buf.length < offset + arr.length) return false;
  for (let i = 0; i < arr.length; i += 1) {
    if (buf[offset + i] !== arr[i]) return false;
  }
  return true;
}

/** Case-insensitive search for an ASCII marker within the header buffer. */
function containsAscii(buf, needle) {
  if (!buf) return false;
  const hay = buf.toString('latin1');
  return hay.includes(needle);
}

// --- RIFF container (WebP / AVI / WAV all start with "RIFF" + size + type) ---
function matchRiff(buf) {
  if (!at(buf, 0, 'RIFF')) return null;
  if (at(buf, 8, 'WEBP')) return { ext: 'webp', mime: 'image/webp', label: 'WebP image' };
  if (at(buf, 8, 'AVI ')) return { ext: 'avi', mime: 'video/x-msvideo', label: 'AVI video' };
  if (at(buf, 8, 'WAVE')) return { ext: 'wav', mime: 'audio/wav', label: 'WAV audio' };
  return null;
}

// --- ISO Base Media File Format ("ftyp" at offset 4; brand at offset 8) ---
const FTYP_BRANDS = {
  isom: { ext: 'mp4', mime: 'video/mp4', label: 'MP4 video' },
  iso2: { ext: 'mp4', mime: 'video/mp4', label: 'MP4 video' },
  iso4: { ext: 'mp4', mime: 'video/mp4', label: 'MP4 video' },
  iso5: { ext: 'mp4', mime: 'video/mp4', label: 'MP4 video' },
  mp41: { ext: 'mp4', mime: 'video/mp4', label: 'MP4 video' },
  mp42: { ext: 'mp4', mime: 'video/mp4', label: 'MP4 video' },
  avc1: { ext: 'mp4', mime: 'video/mp4', label: 'MP4 video' },
  dash: { ext: 'mp4', mime: 'video/mp4', label: 'MP4 video' },
  MSNV: { ext: 'mp4', mime: 'video/mp4', label: 'MP4 video' },
  'M4V ': { ext: 'm4v', mime: 'video/x-m4v', label: 'M4V video' },
  'M4A ': { ext: 'm4a', mime: 'audio/mp4', label: 'M4A audio' },
  'M4B ': { ext: 'm4a', mime: 'audio/mp4', label: 'M4A audio' },
  'M4P ': { ext: 'm4a', mime: 'audio/mp4', label: 'M4A audio' },
  'qt  ': { ext: 'mov', mime: 'video/quicktime', label: 'QuickTime video' },
  '3gp4': { ext: '3gp', mime: 'video/3gpp', label: '3GP video' },
  '3gp5': { ext: '3gp', mime: 'video/3gpp', label: '3GP video' },
  '3g2a': { ext: '3gp', mime: 'video/3gpp2', label: '3G2 video' },
  heic: { ext: 'heic', mime: 'image/heic', label: 'HEIC image' },
  heix: { ext: 'heic', mime: 'image/heic', label: 'HEIC image' },
  mif1: { ext: 'heic', mime: 'image/heif', label: 'HEIF image' },
  msf1: { ext: 'heic', mime: 'image/heif', label: 'HEIF image' },
  avif: { ext: 'avif', mime: 'image/avif', label: 'AVIF image' },
  avis: { ext: 'avif', mime: 'image/avif', label: 'AVIF image' },
};

function matchFtyp(buf) {
  if (!at(buf, 4, 'ftyp')) return null;
  const brand = buf.slice(8, 12).toString('latin1');
  if (FTYP_BRANDS[brand]) return { ...FTYP_BRANDS[brand], brand };
  // An unrecognized ISO-BMFF brand is still an ISO-BMFF file — default to mp4
  // rather than falling through to "unknown" and losing the video category.
  return { ext: 'mp4', mime: 'video/mp4', label: 'MP4 video (unknown brand)', brand };
}

// --- OLE2 compound file (legacy .doc/.xls/.ppt, and .msi) ---
function matchOle2(buf) {
  if (!bytesAt(buf, 0, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return null;
  // The OLE directory entry names live in the header region, so a marker search
  // is enough to tell the three legacy Office types apart.
  if (containsAscii(buf, 'WordDocument')) return { ext: 'doc', mime: 'application/msword', label: 'Word document (legacy)' };
  if (containsAscii(buf, 'Workbook') || containsAscii(buf, 'Book')) return { ext: 'xls', mime: 'application/vnd.ms-excel', label: 'Excel workbook (legacy)' };
  if (containsAscii(buf, 'PowerPoint Document')) return { ext: 'ppt', mime: 'application/vnd.ms-powerpoint', label: 'PowerPoint (legacy)' };
  return { ext: '', mime: 'application/x-ole-storage', label: 'OLE2 compound file' };
}

// --- EBML (Matroska / WebM) ---
function matchEbml(buf) {
  if (!bytesAt(buf, 0, [0x1a, 0x45, 0xdf, 0xa3])) return null;
  if (containsAscii(buf, 'webm')) return { ext: 'webm', mime: 'video/webm', label: 'WebM video' };
  return { ext: 'mkv', mime: 'video/x-matroska', label: 'Matroska video' };
}

/**
 * @param {Buffer} buf the first few KB of the file
 * @returns {{ext:string, mime:string, label:string, zip?:boolean, brand?:string}|null}
 */
export function detectBinary(buf) {
  if (!buf || buf.length < 4) return null;

  if (at(buf, 0, '%PDF-')) return { ext: 'pdf', mime: 'application/pdf', label: 'PDF document' };
  if (bytesAt(buf, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ext: 'png', mime: 'image/png', label: 'PNG image' };
  }
  if (bytesAt(buf, 0, [0xff, 0xd8, 0xff])) return { ext: 'jpg', mime: 'image/jpeg', label: 'JPEG image' };
  if (at(buf, 0, 'GIF87a') || at(buf, 0, 'GIF89a')) return { ext: 'gif', mime: 'image/gif', label: 'GIF image' };
  if (at(buf, 0, 'BM')) return { ext: 'bmp', mime: 'image/bmp', label: 'BMP image' };
  if (bytesAt(buf, 0, [0x49, 0x49, 0x2a, 0x00]) || bytesAt(buf, 0, [0x4d, 0x4d, 0x00, 0x2a])) {
    return { ext: 'tiff', mime: 'image/tiff', label: 'TIFF image' };
  }

  const riff = matchRiff(buf);
  if (riff) return riff;

  const ole = matchOle2(buf);
  if (ole) return ole;

  // Zip container. A .docx/.xlsx/.pptx/.odt IS a zip — flagged `zip: true` so
  // detectFileType can open it and read `[Content_Types].xml` to name it.
  if (at(buf, 0, 'PK\x03\x04') || at(buf, 0, 'PK\x05\x06') || at(buf, 0, 'PK\x07\x08')) {
    return { ext: 'zip', mime: 'application/zip', label: 'Zip archive', zip: true };
  }
  if (at(buf, 0, 'Rar!\x1a\x07\x00') || at(buf, 0, 'Rar!\x1a\x07\x01\x00')) {
    return { ext: 'rar', mime: 'application/vnd.rar', label: 'RAR archive' };
  }
  if (bytesAt(buf, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) {
    return { ext: '7z', mime: 'application/x-7z-compressed', label: '7-Zip archive' };
  }
  if (bytesAt(buf, 0, [0x1f, 0x8b])) return { ext: 'gz', mime: 'application/gzip', label: 'Gzip archive' };
  if (at(buf, 257, 'ustar')) return { ext: 'tar', mime: 'application/x-tar', label: 'TAR archive' };
  if (bytesAt(buf, 0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return { ext: 'xz', mime: 'application/x-xz', label: 'XZ archive' };
  if (bytesAt(buf, 0, [0x42, 0x5a, 0x68])) return { ext: 'bz2', mime: 'application/x-bzip2', label: 'Bzip2 archive' };
  if (bytesAt(buf, 0, [0x28, 0xb5, 0x2f, 0xfd])) return { ext: 'zst', mime: 'application/zstd', label: 'Zstandard archive' };

  const ebml = matchEbml(buf);
  if (ebml) return ebml;

  const ftyp = matchFtyp(buf);
  if (ftyp) return ftyp;

  if (at(buf, 0, 'OggS')) return { ext: 'ogg', mime: 'audio/ogg', label: 'Ogg audio' };
  if (at(buf, 0, 'fLaC')) return { ext: 'flac', mime: 'audio/flac', label: 'FLAC audio' };
  if (at(buf, 0, 'ID3')) return { ext: 'mp3', mime: 'audio/mpeg', label: 'MP3 audio' };
  // ADTS AAC: 0xFFF sync, layer bits 00. Checked before the generic MP3 sync
  // because both begin with 0xFF.
  if (bytesAt(buf, 0, [0xff, 0xf1]) || bytesAt(buf, 0, [0xff, 0xf9])) {
    return { ext: 'aac', mime: 'audio/aac', label: 'AAC audio' };
  }
  // Bare MPEG audio frame sync (no ID3 tag) — 11 set bits.
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    return { ext: 'mp3', mime: 'audio/mpeg', label: 'MP3 audio' };
  }

  // --- Executables / script loaders. Detected so the upload path can REJECT
  // them by policy rather than filing them under "other" — an academic portal
  // has no legitimate reason to accept a PE/ELF binary, and "other" would
  // otherwise make it storable and silently un-optimizable. ---
  if (at(buf, 0, 'MZ')) return { ext: 'exe', mime: 'application/x-msdownload', label: 'Windows executable', dangerous: true };
  if (bytesAt(buf, 0, [0x7f, 0x45, 0x4c, 0x46])) {
    return { ext: 'elf', mime: 'application/x-executable', label: 'ELF executable', dangerous: true };
  }
  if (at(buf, 0, '#!')) return { ext: 'sh', mime: 'application/x-sh', label: 'Script', dangerous: true };
  if (bytesAt(buf, 0, [0xca, 0xfe, 0xba, 0xbe])) {
    return { ext: 'class', mime: 'application/java-vm', label: 'Java class', dangerous: true };
  }

  return null;
}

export default { detectBinary };
