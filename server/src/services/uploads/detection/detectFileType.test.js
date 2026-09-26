import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFileType } from './detectFileType.js';

const buf = (...parts) => Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p, 'latin1'))));

test('detects PNG by magic bytes and marks it already-compressed', () => {
  const png = buf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'IHDR');
  const result = detectFileType(png);
  assert.equal(result.ext, 'png');
  assert.equal(result.mime, 'image/png');
  assert.equal(result.category, 'image');
  assert.equal(result.alreadyCompressed, true);
  assert.equal(result.textLike, false);
  assert.equal(result.source, 'magic');
});

test('detects JPEG, GIF, BMP, TIFF, WebP', () => {
  assert.equal(detectFileType(buf([0xff, 0xd8, 0xff, 0xe0])).mime, 'image/jpeg');
  assert.equal(detectFileType(buf('GIF89a')).mime, 'image/gif');
  assert.equal(detectFileType(buf('BM', [0, 0, 0, 0])).mime, 'image/bmp');
  assert.equal(detectFileType(buf([0x49, 0x49, 0x2a, 0x00])).mime, 'image/tiff');
  assert.equal(detectFileType(buf('RIFF', [0, 0, 0, 0], 'WEBP')).mime, 'image/webp');
});

test('detects PDF', () => {
  const result = detectFileType(buf('%PDF-1.7\n%âãÏÓ'));
  assert.equal(result.ext, 'pdf');
  assert.equal(result.mime, 'application/pdf');
  assert.equal(result.category, 'document');
});

test('detects a plain zip as an archive and marks it already-compressed', () => {
  const zip = buf('PK\x03\x04', 'some/entry.txt....');
  const result = detectFileType(zip);
  assert.equal(result.ext, 'zip');
  assert.equal(result.category, 'archive');
  assert.equal(result.alreadyCompressed, true);
});

test('refines a zip into DOCX / XLSX / PPTX from the package parts', () => {
  const docx = detectFileType(buf('PK\x03\x04', '...[Content_Types].xml...word/document.xml...'));
  assert.equal(docx.ext, 'docx');
  assert.equal(docx.category, 'document');
  assert.equal(docx.source, 'container');

  const xlsx = detectFileType(buf('PK\x03\x04', '...xl/workbook.xml...'));
  assert.equal(xlsx.ext, 'xlsx');

  const pptx = detectFileType(buf('PK\x03\x04', '...ppt/presentation.xml...'));
  assert.equal(pptx.ext, 'pptx');
});

test('detects ODF as its own type, not a generic zip', () => {
  const odt = detectFileType(buf('PK\x03\x04', 'mimetypeapplication/vnd.oasis.opendocument.text'));
  assert.equal(odt.ext, 'odt');
});

test('detects MP4/MOV/M4A via the ftyp brand', () => {
  const mp4 = detectFileType(buf([0, 0, 0, 0x18], 'ftypisom', [0, 0, 0, 0]));
  assert.equal(mp4.ext, 'mp4');
  assert.equal(mp4.category, 'video');

  const mov = detectFileType(buf([0, 0, 0, 0x14], 'ftypqt  '));
  assert.equal(mov.ext, 'mov');

  const m4a = detectFileType(buf([0, 0, 0, 0x14], 'ftypM4A '));
  assert.equal(m4a.ext, 'm4a');
  assert.equal(m4a.category, 'audio');
});

test('detects MKV/WebM via EBML', () => {
  assert.equal(detectFileType(buf([0x1a, 0x45, 0xdf, 0xa3], '...matroska...')).ext, 'mkv');
  assert.equal(detectFileType(buf([0x1a, 0x45, 0xdf, 0xa3], '...webm...')).ext, 'webm');
});

test('detects audio formats', () => {
  assert.equal(detectFileType(buf('ID3', [3, 0, 0, 0])).ext, 'mp3');
  assert.equal(detectFileType(buf('OggS', [0, 2, 0, 0])).ext, 'ogg');
  assert.equal(detectFileType(buf('fLaC', [0, 0, 0, 0x22])).ext, 'flac');
  assert.equal(detectFileType(buf('RIFF', [0, 0, 0, 0], 'WAVE')).ext, 'wav');
});

test('detects archives: RAR, 7z, gz, tar, xz', () => {
  assert.equal(detectFileType(buf('Rar!\x1a\x07\x00')).ext, 'rar');
  assert.equal(detectFileType(buf([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])).ext, '7z');
  assert.equal(detectFileType(buf([0x1f, 0x8b, 0x08, 0x00])).ext, 'gz');
  const tar = Buffer.alloc(600);
  tar.write('ustar', 257, 'latin1');
  assert.equal(detectFileType(tar).ext, 'tar');
});

test('sniffs text formats: SVG, JSON, CSV, RTF, plain text', () => {
  assert.equal(detectFileType(buf('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).ext, 'svg');
  assert.equal(detectFileType(buf('{"a":1,"b":[2,3]}')).ext, 'json');
  assert.equal(detectFileType(buf('name,age,city\nalice,30,nyc\nbob,25,la\n')).ext, 'csv');
  assert.equal(detectFileType(buf('{\\rtf1\\ansi hello}')).ext, 'rtf');
  assert.equal(detectFileType(buf('just some plain text\nsecond line\n')).ext, 'txt');
});

test('a single line with commas is prose, not a CSV', () => {
  assert.equal(detectFileType(buf('Hello, world, this is one sentence.\n')).ext, 'txt');
});

test('flags executables as dangerous', () => {
  assert.equal(detectFileType(buf('MZ', [0x90, 0x00, 0x03])).dangerous, true);
  assert.equal(detectFileType(buf([0x7f, 0x45, 0x4c, 0x46, 0x02])).dangerous, true);
});

test('never trusts a spoofed client MIME, and reports the mismatch', () => {
  // An executable renamed to .pdf with a lying Content-Type.
  const spoof = detectFileType(buf('MZ', [0x90, 0x00, 0x03, 0x00]), {
    originalName: 'assignment.pdf',
    clientMime: 'application/pdf',
  });
  assert.equal(spoof.dangerous, true);
  assert.equal(spoof.mismatch, true);
  assert.notEqual(spoof.category, 'document');
});

test('falls back to "other" for an unrecognized binary, never guessing a category', () => {
  const weird = detectFileType(Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]));
  assert.equal(weird.detected, false);
  assert.equal(weird.category, 'other');
});

test('a truncated JSON buffer is still recognized as JSON', () => {
  const partial = detectFileType(buf('{"students":[{"name":"A","roll":"1"},{"name":"B","rol'));
  assert.equal(partial.ext, 'json');
});
