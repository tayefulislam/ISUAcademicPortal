import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isValidHttpsUrl, requireValidHttpsUrl } from './externalUrl.js';

// The external-material-link gate. Only an absolute https:// URL with a host is
// accepted — every other scheme is rejected so a stored link can never become an
// injection vector when a client renders it.
describe('isValidHttpsUrl', () => {
  test('accepts common document-sharing links', () => {
    assert.equal(isValidHttpsUrl('https://drive.google.com/file/d/abc123/view'), true);
    assert.equal(isValidHttpsUrl('https://1drv.ms/u/s!abc'), true);
    assert.equal(isValidHttpsUrl('https://www.dropbox.com/s/xyz/report.pdf?dl=0'), true);
    assert.equal(isValidHttpsUrl('https://example.edu/materials/notes.pdf'), true);
  });

  test('rejects non-https and non-absolute values', () => {
    assert.equal(isValidHttpsUrl('http://example.com/file.pdf'), false);
    assert.equal(isValidHttpsUrl('ftp://example.com/file.pdf'), false);
    assert.equal(isValidHttpsUrl('/uploads/pdf/file.pdf'), false);
    assert.equal(isValidHttpsUrl('example.com/file.pdf'), false);
    assert.equal(isValidHttpsUrl('https://'), false);
  });

  test('rejects dangerous schemes outright', () => {
    assert.equal(isValidHttpsUrl('javascript:alert(1)'), false);
    assert.equal(isValidHttpsUrl('data:text/html;base64,PHNjcmlwdD4='), false);
    assert.equal(isValidHttpsUrl('file:///etc/passwd'), false);
  });

  test('rejects empty, non-string and over-long input', () => {
    assert.equal(isValidHttpsUrl(''), false);
    assert.equal(isValidHttpsUrl('   '), false);
    assert.equal(isValidHttpsUrl(null), false);
    assert.equal(isValidHttpsUrl(undefined), false);
    assert.equal(isValidHttpsUrl(42), false);
    assert.equal(isValidHttpsUrl(`https://example.com/${'a'.repeat(2100)}`), false);
  });

  test('trims surrounding whitespace before validating', () => {
    assert.equal(isValidHttpsUrl('  https://example.com/a.pdf  '), true);
  });
});

describe('requireValidHttpsUrl', () => {
  test('returns the trimmed URL when valid', () => {
    assert.equal(requireValidHttpsUrl('  https://example.com/a.pdf '), 'https://example.com/a.pdf');
  });

  test('throws a 400 on an invalid URL', () => {
    assert.throws(() => requireValidHttpsUrl('http://example.com'), (err) => err.statusCode === 400);
  });
});
