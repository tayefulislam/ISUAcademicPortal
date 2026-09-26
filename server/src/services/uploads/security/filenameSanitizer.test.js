import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFilename, safeExtension, safeSegment, buildStorageKey, contentDisposition } from './filenameSanitizer.js';

test('strips directory components from both separators (no path traversal)', () => {
  // Only the final component is kept — taking the basename is what makes
  // traversal impossible, rather than trying to sanitize a whole path.
  assert.equal(sanitizeFilename('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFilename('..\\..\\windows\\system32\\config'), 'config');
  assert.equal(sanitizeFilename('/absolute/path/file.pdf'), 'file.pdf');
  assert.equal(sanitizeFilename('C:/Users/x/notes.docx'), 'notes.docx');
  // A traversal attempt with an extension keeps only the safe final name.
  assert.equal(sanitizeFilename('../../../../etc/shadow.txt'), 'shadow.txt');
});

test('removes a bare traversal name entirely', () => {
  assert.equal(sanitizeFilename('..'), 'file');
  assert.equal(sanitizeFilename('.'), 'file');
  assert.equal(sanitizeFilename(''), 'file');
});

test('kills control characters, header-breakers and null bytes', () => {
  const result = sanitizeFilename('bad\r\nname.txt');
  assert.ok(!result.includes('\r'));
  assert.ok(!result.includes('\n'));
  assert.equal(sanitizeFilename('null\u0000byte.txt').includes('\u0000'), false);
  assert.equal(sanitizeFilename('quote".txt'), 'quote_.txt');
});

test('neutralizes Windows reserved device names', () => {
  assert.equal(sanitizeFilename('CON.txt'), '_CON.txt');
  assert.equal(sanitizeFilename('nul'), '_nul');
});

test('bounds the length but preserves the extension', () => {
  const long = `${'a'.repeat(400)}.pdf`;
  const result = sanitizeFilename(long);
  assert.ok(result.length <= 180);
  assert.ok(result.endsWith('.pdf'));
});

test('keeps a normal filename untouched', () => {
  assert.equal(sanitizeFilename('Lecture 3 - Cell Biology.pdf'), 'Lecture 3 - Cell Biology.pdf');
});

test('safeExtension allow-lists and falls back to bin', () => {
  assert.equal(safeExtension('.PDF'), 'pdf');
  assert.equal(safeExtension('jpg'), 'jpg');
  assert.equal(safeExtension('ta;rm -rf'), 'tarmrf');
  assert.equal(safeExtension(''), 'bin');
  assert.equal(safeExtension('averyveryverylongextension'), 'bin');
});

test('safeSegment produces one clean key segment', () => {
  assert.equal(safeSegment('Academic Material'), 'academic-material');
  assert.equal(safeSegment('!!!'), 'general');
  assert.equal(safeSegment(''), 'general');
});

test('buildStorageKey is generated, never derived from user input', () => {
  const key = buildStorageKey({ purpose: 'academic-material', ownerId: '64abc123', extension: 'pdf' });
  assert.match(key, /^academic-material\/\d{4}\/\d{2}\/64abc123\/[a-z0-9-]+\.[a-z0-9]+$/);
  assert.ok(key.endsWith('.pdf'));
  assert.ok(!key.includes('..'));

  // Two calls never collide.
  assert.notEqual(key, buildStorageKey({ purpose: 'academic-material', ownerId: '64abc123', extension: 'pdf' }));
});

test('buildStorageKey sanitizes a hostile purpose and extension', () => {
  const key = buildStorageKey({ purpose: '../../evil', ownerId: '1', extension: 'p/df' });
  assert.ok(!key.includes('..'));
  assert.match(key, /^evil\//);
  assert.ok(key.endsWith('.pdf'));
});

test('contentDisposition escapes quotes and newlines and offers an RFC 6266 filename', () => {
  const header = contentDisposition('attachment', 'a"b\nc.pdf');
  assert.ok(!header.includes('\n'));
  assert.ok(header.startsWith('attachment; filename="'));
  assert.ok(header.includes("filename*=UTF-8''"));
});
