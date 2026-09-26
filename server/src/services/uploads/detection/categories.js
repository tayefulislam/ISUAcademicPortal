/**
 * The taxonomy the whole upload system reasons about: which CATEGORY a file
 * belongs to (drives size limits), whether it is already compressed (drives
 * "do not waste CPU on it"), and whether it is text-like (drives the streaming
 * compression path).
 *
 * Kept as plain data + pure predicates so it is trivially unit-testable and so
 * every caller shares one definition — no `if (ext === 'zip' || ...)` scattered
 * through the processors.
 */

export const CATEGORIES = ['image', 'document', 'archive', 'video', 'audio', 'other'];

// Extension → category. The primary mapping, used once the real type has been
// determined (from magic bytes, not from this table — see detectFileType).
export const EXT_TO_CATEGORY = {
  // images
  jpg: 'image', jpeg: 'image', jpe: 'image', png: 'image', webp: 'image', gif: 'image',
  bmp: 'image', tif: 'image', tiff: 'image', svg: 'image', heic: 'image', heif: 'image',
  avif: 'image', ico: 'image',
  // documents
  pdf: 'document', doc: 'document', docx: 'document', xls: 'document', xlsx: 'document',
  ppt: 'document', pptx: 'document', txt: 'document', text: 'document', csv: 'document',
  tsv: 'document', rtf: 'document', json: 'document', xml: 'document', md: 'document',
  html: 'document', htm: 'document', odt: 'document', ods: 'document', odp: 'document',
  pages: 'document', numbers: 'document', key: 'document',
  // archives
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  tgz: 'archive', bz2: 'archive', xz: 'archive', zst: 'archive', lz: 'archive',
  // video
  mp4: 'video', m4v: 'video', mkv: 'video', mov: 'video', avi: 'video', webm: 'video',
  wmv: 'video', flv: 'video', mpg: 'video', mpeg: 'video', '3gp': 'video', ts: 'video',
  // audio
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', oga: 'audio',
  opus: 'audio', flac: 'audio', wma: 'audio', aiff: 'audio', aif: 'audio', amr: 'audio',
};

// MIME prefix → category. Used when magic bytes are inconclusive but a real
// MIME was supplied (e.g. an exotic text subtype).
export function categoryForMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (!m) return null;
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('text/')) return 'document';
  if (m === 'application/pdf') return 'document';
  if (m === 'application/json' || m.endsWith('+json')) return 'document';
  if (m === 'application/xml' || m.endsWith('+xml')) return 'document';
  if (m === 'application/rtf') return 'document';
  if (
    m === 'application/msword' ||
    m === 'application/vnd.ms-excel' ||
    m === 'application/vnd.ms-powerpoint' ||
    m.startsWith('application/vnd.openxmlformats-officedocument') ||
    m.startsWith('application/vnd.oasis.opendocument')
  ) {
    return 'document';
  }
  if (m === 'application/zip' || m === 'application/x-zip-compressed' || m === 'application/x-tar') return 'archive';
  if (m === 'application/gzip' || m === 'application/x-7z-compressed' || m === 'application/vnd.rar' || m === 'application/x-rar-compressed') return 'archive';
  if (m === 'application/x-ole-storage' || m === 'application/x-cfb') return 'document';
  return null;
}

export function categoryForExtension(ext) {
  return EXT_TO_CATEGORY[String(ext || '').toLowerCase().replace(/^\./, '')] || null;
}

/**
 * Formats whose payload is ALREADY compressed — an archive, or a media/image
 * codec with entropy coding built in. Re-compressing these burns CPU and CPU
 * time for nothing (a zip inside a zip shrinks by approximately zero), which is
 * exactly what §8 of the spec forbids. They are stored byte-for-byte.
 *
 * SVG is deliberately absent: it is plain XML text and compresses well.
 */
export const ALREADY_COMPRESSED_EXTS = new Set([
  // archives
  'zip', 'rar', '7z', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'lz',
  // raster images with built-in entropy coding
  'jpg', 'jpeg', 'jpe', 'png', 'webp', 'gif', 'heic', 'heif', 'avif',
  // video
  'mp4', 'm4v', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'mpg', 'mpeg', '3gp',
  // audio
  'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'wma', 'amr',
  // OOXML / ODF are zip containers
  'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp',
]);

// Text-ish formats: compressible with a general-purpose codec, and safe to
// treat as a byte stream (no semantic processing).
export const TEXT_EXTS = new Set([
  'txt', 'text', 'csv', 'tsv', 'rtf', 'json', 'xml', 'md', 'markdown',
  'html', 'htm', 'svg', 'log', 'srt', 'vtt', 'yaml', 'yml', 'ini', 'conf', 'sql',
]);

export function isTextLike(ext, mime) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (TEXT_EXTS.has(e)) return true;
  // A .csv named .dat is still text; the detected MIME settles it.
  const m = String(mime || '').toLowerCase();
  if (m.startsWith('text/')) return true;
  return m === 'application/json' || m === 'application/xml' || m.endsWith('+json') || m.endsWith('+xml');
}

export function isAlreadyCompressed(ext, mime) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (ALREADY_COMPRESSED_EXTS.has(e)) return true;
  // An unknown extension whose MIME is a known-compressed family.
  const m = String(mime || '').toLowerCase();
  return (
    m === 'application/zip' ||
    m === 'application/gzip' ||
    m === 'application/x-7z-compressed' ||
    m === 'application/vnd.rar' ||
    m.startsWith('video/') ||
    m.startsWith('audio/')
  );
}

export default {
  CATEGORIES,
  EXT_TO_CATEGORY,
  ALREADY_COMPRESSED_EXTS,
  TEXT_EXTS,
  categoryForMime,
  categoryForExtension,
  isTextLike,
  isAlreadyCompressed,
};
