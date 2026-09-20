import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  isAssetFileName,
  isDocumentAssetName,
  assetMimeType,
  assetKind,
  sanitizeAssetName,
  saveAsset,
  deleteAsset,
  listAssets,
  readAssetBuffer,
} from './assets.js';

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
    assert.equal(assetMimeType('report.pdf'), 'application/pdf');
    assert.equal(assetMimeType('crest.bin'), 'application/octet-stream');
  });
});

describe('isDocumentAssetName — the library holds images and PDFs', () => {
  test('accepts images and PDFs, but only a bare file name', () => {
    for (const name of ['logo.png', 'crest.JPG', 'seal.webp', 'doc.pdf']) {
      assert.equal(isDocumentAssetName(name), true, name);
    }
    for (const name of ['../doc.pdf', 'sub/logo.png', 'notes.txt', 'doc', '', null, 7]) {
      assert.equal(isDocumentAssetName(name), false, String(name));
    }
  });

  test('separates a PDF from an image, and an IMAGE element may never name a PDF', () => {
    assert.equal(assetKind('logo.png'), 'image');
    assert.equal(assetKind('report.pdf'), 'pdf');
    // The library holds the PDF, but a placed image element still cannot use it.
    assert.equal(isAssetFileName('report.pdf'), false);
    assert.equal(isDocumentAssetName('report.pdf'), true);
  });
});

describe('sanitizeAssetName', () => {
  test('folds an upload into a safe name and keeps a known extension', () => {
    assert.equal(sanitizeAssetName('ISU Logo (final).PNG'), 'isu-logo-final.png');
    assert.equal(sanitizeAssetName('report.pdf'), 'report.pdf');
  });

  test('refuses a path traversal or an unsupported type', () => {
    assert.equal(sanitizeAssetName('../../etc/passwd'), '');
    assert.equal(sanitizeAssetName('notes.txt'), '');
    assert.equal(sanitizeAssetName('payload.exe'), '');
  });
});

describe('saveAsset / deleteAsset — the uploaded half of the library', () => {
  test('stores an upload, reads it back, then removes it', async () => {
    const saved = await saveAsset(Buffer.from('hello'), 'Test Asset.PNG');
    assert.equal(saved.name, 'test-asset.png');
    assert.equal(saved.kind, 'image');
    assert.equal(saved.source, 'uploaded');

    assert.ok((await listAssets()).some((a) => a.name === saved.name && a.source === 'uploaded'));
    assert.equal((await readAssetBuffer(saved.name)).toString(), 'hello');

    await deleteAsset(saved.name);
    assert.equal((await listAssets()).some((a) => a.name === saved.name), false);
  });

  test('a second upload of the same name never overwrites the first', async () => {
    const first = await saveAsset(Buffer.from('one'), 'dup.png');
    const second = await saveAsset(Buffer.from('two'), 'dup.png');
    try {
      assert.notEqual(first.name, second.name);
      assert.equal((await readAssetBuffer(first.name)).toString(), 'one');
      assert.equal((await readAssetBuffer(second.name)).toString(), 'two');
    } finally {
      await deleteAsset(first.name);
      await deleteAsset(second.name);
    }
  });

  test('an unsupported type is refused', async () => {
    await assert.rejects(() => saveAsset(Buffer.from('x'), 'payload.exe'), (err) => err.statusCode === 400);
  });

  test('a bundled repository file cannot be deleted through the upload path', async () => {
    // logo.png ships in `server/img`, not in the upload folder, so a delete
    // finds nothing there rather than removing the repository's own file.
    await assert.rejects(() => deleteAsset('logo.png'), (err) => err.statusCode === 404);
  });
});
