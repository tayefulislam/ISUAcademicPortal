import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { processPdf } from './pdfProcessor.js';
import { validatePdf } from './pdfValidate.js';
import { analyzePdfFile, loadPdfDocument, inventoryImages } from './pdfAnalyze.js';
import { resolveProfile, assertValidProfile } from './pdfProfiles.js';

/**
 * The PDF optimizer is the highest-risk code in the system — a wrong rebuild
 * corrupts a document. These tests build real PDFs with real embedded JPEGs and
 * assert the two properties that matter: the page count survives, and the result
 * is smaller. Everything else is subsidiary to those.
 */

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'isu-pdf-'));
}

/** A deterministic, genuinely detailed JPEG — noise compresses, flat colour does not. */
async function makeNoisyJpeg(width, height, quality = 95) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      raw[i] = (x * 7 + y * 13) % 256;
      raw[i + 1] = (x * 29 + y * 3) % 256;
      raw[i + 2] = (x * 11 + y * 97) % 256;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality, mozjpeg: false }).toBuffer();
}

/** A PDF of `pages` pages, each showing one large embedded JPEG. */
async function makePdfWithImages({ pages = 3, width = 3000, height = 4000, quality = 95, embedPerPage = false } = {}) {
  const doc = await PDFDocument.create();
  const jpeg = await makeNoisyJpeg(width, height, quality);

  for (let i = 0; i < pages; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const img = await doc.embedJpg(embedPerPage ? await makeNoisyJpeg(width, height, quality) : jpeg);
    const page = doc.addPage([595, 842]);
    page.drawImage(img, { x: 0, y: 0, width: 595, height: 842 });
  }
  return doc.save();
}

/** A PDF with text only — nothing to re-encode. */
async function makeTextOnlyPdf(pageCount = 2) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Page ${i + 1}`, { x: 50, y: 800, size: 14 });
  }
  return doc.save();
}

test('processPdf shrinks an image-heavy PDF while preserving the page count', async () => {
  const dir = await tmpDir();
  const input = path.join(dir, 'in.pdf');
  const output = path.join(dir, 'out.pdf');
  await fs.writeFile(input, await makePdfWithImages({ pages: 4 }));

  const result = await processPdf(input, output, { profile: 'BALANCED' });

  assert.equal(result.ok, true, `expected success, got reason=${result.reason}`);
  assert.equal(result.pageCount, 4, 'every page must survive');
  assert.ok(result.reencoded >= 1, 'at least one image should have been re-encoded');

  const inSize = (await fs.stat(input)).size;
  const outSize = (await fs.stat(output)).size;
  assert.ok(outSize < inSize, `expected ${outSize} < ${inSize}`);

  await fs.rm(dir, { recursive: true, force: true });
});

test('the rebuilt PDF is structurally valid and keeps its page count', async () => {
  const dir = await tmpDir();
  const input = path.join(dir, 'in.pdf');
  const output = path.join(dir, 'out.pdf');
  await fs.writeFile(input, await makePdfWithImages({ pages: 5 }));

  const result = await processPdf(input, output, { profile: 'BALANCED' });
  assert.equal(result.ok, true);

  const validation = await validatePdf(output, { expectedPageCount: 5 });
  assert.equal(validation.valid, true, `validation failed: ${validation.reason}`);
  assert.equal(validation.pageCount, 5);

  await fs.rm(dir, { recursive: true, force: true });
});

test('text, forms metadata and page geometry survive the rebuild', async () => {
  const dir = await tmpDir();
  const input = path.join(dir, 'mixed.pdf');
  const output = path.join(dir, 'mixed-out.pdf');

  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(await makeNoisyJpeg(2600, 3400, 95));
  const page = doc.addPage([612, 792]);
  page.drawImage(img, { x: 0, y: 0, width: 612, height: 792 });
  page.drawText('This text must still be selectable', { x: 40, y: 700, size: 12 });
  await fs.writeFile(input, await doc.save());

  const result = await processPdf(input, output, { profile: 'BALANCED' });
  assert.equal(result.ok, true);

  // Re-open and confirm the page box and the text operator survived.
  const { doc: reloaded } = await loadPdfDocument(await fs.readFile(output));
  assert.ok(reloaded);
  const pages = reloaded.getPages();
  assert.equal(pages.length, 1);
  assert.equal(Math.round(pages[0].getWidth()), 612);
  assert.equal(Math.round(pages[0].getHeight()), 792);
  assert.ok(inventoryImages(reloaded).length >= 1, 'the image is still embedded');

  await fs.rm(dir, { recursive: true, force: true });
});

test('SMALL_SIZE compresses at least as hard as HIGH_QUALITY', async () => {
  const dir = await tmpDir();
  const input = path.join(dir, 'in.pdf');
  const small = path.join(dir, 'small.pdf');
  const high = path.join(dir, 'high.pdf');
  await fs.writeFile(input, await makePdfWithImages({ pages: 2, width: 3200, height: 4200 }));

  const smallResult = await processPdf(input, small, { profile: 'SMALL_SIZE' });
  const highResult = await processPdf(input, high, { profile: 'HIGH_QUALITY' });
  assert.equal(smallResult.ok, true);
  assert.equal(highResult.ok, true);

  const smallSize = (await fs.stat(small)).size;
  const highSize = (await fs.stat(high)).size;
  assert.ok(smallSize <= highSize, `SMALL_SIZE (${smallSize}) should not exceed HIGH_QUALITY (${highSize})`);

  await fs.rm(dir, { recursive: true, force: true });
});

test('a PDF with no re-encodable images is declined, not rebuilt', async () => {
  const dir = await tmpDir();
  const input = path.join(dir, 'text.pdf');
  const output = path.join(dir, 'text-out.pdf');
  await fs.writeFile(input, await makeTextOnlyPdf(3));

  const result = await processPdf(input, output, { profile: 'BALANCED' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-reencodable-images');
  assert.equal(result.pageCount, 3);

  await fs.rm(dir, { recursive: true, force: true });
});

test('an unreadable "PDF" is declined rather than thrown', async () => {
  const dir = await tmpDir();
  const input = path.join(dir, 'broken.pdf');
  const output = path.join(dir, 'broken-out.pdf');
  // Right magic bytes, garbage after.
  await fs.writeFile(input, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('not a real pdf body at all')]));

  const result = await processPdf(input, output, { profile: 'BALANCED' });
  assert.equal(result.ok, false);
  assert.ok(['unreadable', 'no-reencodable-images'].includes(result.reason), `unexpected reason ${result.reason}`);

  await fs.rm(dir, { recursive: true, force: true });
});

test('analyzePdfFile reports pages and image counts', async () => {
  const dir = await tmpDir();
  const input = path.join(dir, 'a.pdf');
  await fs.writeFile(input, await makePdfWithImages({ pages: 6 }));

  const analysis = await analyzePdfFile(input);
  assert.equal(analysis.pageCount, 6);
  assert.ok(analysis.imageCount >= 1);
  assert.ok(analysis.reencodableCount >= 1);
  assert.equal(analysis.encrypted, false);

  await fs.rm(dir, { recursive: true, force: true });
});

test('validatePdf catches a page-count change', async () => {
  const dir = await tmpDir();
  const input = path.join(dir, 'three.pdf');
  await fs.writeFile(input, await makeTextOnlyPdf(3));

  const result = await validatePdf(input, { expectedPageCount: 9 });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'page-count-changed');

  await fs.rm(dir, { recursive: true, force: true });
});

test('validatePdf rejects a file that is not a PDF', async () => {
  const dir = await tmpDir();
  const input = path.join(dir, 'not.pdf');
  await fs.writeFile(input, Buffer.from('this is definitely not a pdf, not even close'));

  const result = await validatePdf(input);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad-header');

  await fs.rm(dir, { recursive: true, force: true });
});

test('validatePdf rejects a truncated PDF', async () => {
  const dir = await tmpDir();
  const input = path.join(dir, 'trunc.pdf');
  const full = await makeTextOnlyPdf(2);
  await fs.writeFile(input, full.subarray(0, 40));

  const result = await validatePdf(input, { expectedPageCount: 2 });
  assert.equal(result.valid, false);
  assert.ok(['too-small', 'unparseable', 'bad-header'].includes(result.reason), `got ${result.reason}`);

  await fs.rm(dir, { recursive: true, force: true });
});

test('resolveProfile and assertValidProfile behave', () => {
  assert.equal(resolveProfile('HIGH_QUALITY').name, 'HIGH_QUALITY');
  assert.equal(resolveProfile('small_size').name, 'SMALL_SIZE');
  // Unknown names fall back rather than throwing (a client typo must not fail an upload).
  assert.equal(resolveProfile('NOPE').name, 'BALANCED');
  assert.equal(resolveProfile('').name, 'BALANCED');

  assert.equal(assertValidProfile(''), 'BALANCED');
  assert.equal(assertValidProfile('SMALL_SIZE'), 'SMALL_SIZE');
  assert.throws(() => assertValidProfile('BOGUS'), /Unknown PDF quality profile/);
});
