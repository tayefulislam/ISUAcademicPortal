import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isAssetFileName, assetMimeType } from './assets.js';

// The guard that keeps a template from naming anything but a plain image file in
// the server's img/ folder.
describe('isAssetFileName', () => {
  test('accepts a bare image file name', () => {
    for (const name of ['logo.png', 'crest.jpg', 'mark.jpeg', 'seal.webp', 'icon.gif', 'crest.svg']) {
      assert.equal(isAssetFileName(name), true, name);
    }
  });

  test('rejects a path, traversal, or a non-image', () => {
    for (const name of [
      '../logo.png',
      'sub/logo.png',
      '..\\logo.png',
      '/etc/passwd',
      'logo.exe',
      'logo',
      '',
      null,
      undefined,
      42,
    ]) {
      assert.equal(isAssetFileName(name), false, String(name));
    }
  });

  test('tolerates surrounding whitespace', () => {
    assert.equal(isAssetFileName('  logo.png  '), true);
  });
});

describe('assetMimeType', () => {
  test('maps the known extensions and falls back safely', () => {
    assert.equal(assetMimeType('logo.png'), 'image/png');
    assert.equal(assetMimeType('crest.JPG'), 'image/jpeg');
    assert.equal(assetMimeType('crest.svg'), 'image/svg+xml');
    assert.equal(assetMimeType('crest.bin'), 'application/octet-stream');
  });
});
