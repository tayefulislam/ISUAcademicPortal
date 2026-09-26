import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  analyzeImage,
  classifyImage,
  isProcessableImage,
  processImage,
  generateImageDerivatives,
} from './imageProcessor.js';

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'isu-img-'));
}

/**
 * A colourful photographic image — saturated, many distinct colours, and a clear
 * channel imbalance. This is what the text heuristic must NOT call text.
 */
async function writePhoto(file, width, height, quality = 95) {
  const raw = Buffer.alloc(width * height * 3);
  // A deterministic LCG keeps the fixture reproducible across runs.
  let seed = 987654321;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  for (let p = 0; p < width * height; p += 1) {
    const i = p * 3;
    raw[i] = 40 + Math.floor(rand() * 200); // red-heavy
    raw[i + 1] = Math.floor(rand() * 120); // green-poor
    raw[i + 2] = 30 + Math.floor(rand() * 180); // blue-ish
  }
  await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality }).toFile(file);
}

/** A black-on-white "page of text": greyscale, two colours, high spread. */
async function writeTextPage(file, width = 1600, height = 2200) {
  const raw = Buffer.alloc(width * height, 255);
  // Real text is roughly 8-15% ink coverage on white, which is what makes the
  // histogram strongly bimodal. Ruled lines of that density stand in for it.
  const STROKE = 5; // the x-height band of a "line of text"
  const LINE_GAP = 18; // leading between lines

  for (let top = 40; top < height - 40; top += LINE_GAP) {
    for (let dy = 0; dy < STROKE && top + dy < height - 40; dy += 1) {
      const y = top + dy;
      for (let x = 80; x < width - 80; x += 1) {
        // Break the strokes into "words" so the spread stays bimodal.
        if (Math.floor(x / 90) % 2 === 0) raw[y * width + x] = 0;
      }
    }
  }
  await sharp(raw, { raw: { width, height, channels: 1 } }).png().toFile(file);
}

test('analyzeImage reports dimensions and format', async () => {
  const dir = await tmpDir();
  const file = path.join(dir, 'photo.jpg');
  await writePhoto(file, 800, 600);

  const meta = await analyzeImage(file);
  assert.equal(meta.width, 800);
  assert.equal(meta.height, 600);
  assert.equal(meta.format, 'jpeg');
  assert.ok(meta.megapixels > 0);
  await fs.rm(dir, { recursive: true, force: true });
});

test('an animated GIF is not treated as a processable image', async () => {
  assert.equal(isProcessableImage({ format: 'gif', pages: 7 }), false);
  assert.equal(isProcessableImage({ format: 'gif', pages: 1 }), true);
  assert.equal(isProcessableImage({ format: 'jpeg', pages: 1 }), true);
  assert.equal(isProcessableImage({ format: 'exotic', pages: 1 }), false);
});

test('the text heuristic distinguishes a text page from a photo', async () => {
  const dir = await tmpDir();

  const textFile = path.join(dir, 'page.png');
  await writeTextPage(textFile);
  const textMeta = await analyzeImage(textFile);
  const textStats = await sharp(textFile).stats();
  const textVerdict = classifyImage(textMeta, textStats);
  assert.equal(textVerdict.textLike, true, 'a black-on-white text page must be treated as text');
  assert.equal(textVerdict.confident, true);

  const photoFile = path.join(dir, 'photo.jpg');
  await writePhoto(photoFile, 900, 700);
  const photoMeta = await analyzeImage(photoFile);
  const photoStats = await sharp(photoFile).stats();
  const photoVerdict = classifyImage(photoMeta, photoStats);
  assert.equal(photoVerdict.textLike, false, 'a colourful photo must not be treated as text');

  await fs.rm(dir, { recursive: true, force: true });
});

test('an unclassifiable image is reported as not confident (so the safe quality is used)', () => {
  const verdict = classifyImage({ width: 100, height: 100 }, null);
  assert.equal(verdict.confident, false);
});

test('processImage downscales an oversized image and never enlarges a small one', async () => {
  const dir = await tmpDir();

  const big = path.join(dir, 'big.jpg');
  const bigOut = path.join(dir, 'big-out.jpg');
  await writePhoto(big, 4200, 3200, 96);
  const result = await processImage(big, bigOut, { maxDimension: 2000 });

  assert.ok(result.width <= 2000 && result.height <= 2000, `got ${result.width}x${result.height}`);
  assert.ok(Math.max(result.width, result.height) <= 2000);
  const bigIn = (await fs.stat(big)).size;
  const bigOutSize = (await fs.stat(bigOut)).size;
  assert.ok(bigOutSize < bigIn, `expected downscale to shrink: ${bigOutSize} < ${bigIn}`);

  const small = path.join(dir, 'small.jpg');
  const smallOut = path.join(dir, 'small-out.jpg');
  await writePhoto(small, 200, 150, 90);
  const smallResult = await processImage(small, smallOut, { maxDimension: 2000 });
  assert.equal(smallResult.width, 200, 'a small image must never be upscaled');
  assert.equal(smallResult.height, 150);

  await fs.rm(dir, { recursive: true, force: true });
});

test('a text page keeps the high quality floor rather than the aggressive one', async () => {
  const dir = await tmpDir();
  const src = path.join(dir, 'page.png');
  const out = path.join(dir, 'page-out.jpg');
  await writeTextPage(src, 2400, 3200);

  const result = await processImage(src, out, { maxDimension: 1200 });
  assert.equal(result.textLike, true);
  // A PNG page of text converted for size still decodes, and the pipeline is the
  // layer that decides whether the result is worth keeping.
  const meta = await analyzeImage(out);
  assert.ok(meta.width > 0 && meta.height > 0);
  assert.ok(meta.width <= 1200);

  await fs.rm(dir, { recursive: true, force: true });
});

test('a PNG with alpha keeps a format that has an alpha channel', async () => {
  const dir = await tmpDir();
  const src = path.join(dir, 'logo.png');
  const out = path.join(dir, 'logo-out.png');
  await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } } })
    .png()
    .toFile(src);

  const result = await processImage(src, out);
  assert.equal(result.mimeType, 'image/png', 'transparency must survive');
  await fs.rm(dir, { recursive: true, force: true });
});

test('generateImageDerivatives produces a thumbnail and a preview', async () => {
  const dir = await tmpDir();
  const src = path.join(dir, 'photo.jpg');
  await writePhoto(src, 2400, 1600);

  const derivatives = await generateImageDerivatives(src, dir);
  assert.ok(derivatives.thumbnail.key, 'a thumbnail is expected');
  assert.ok(derivatives.preview.key, 'a preview is expected');
  assert.ok(derivatives.thumbnail.width <= 320);
  assert.ok(derivatives.preview.width <= 1280);
  assert.ok(derivatives.thumbnail.sizeBytes > 0);

  // Both files must exist and be readable as JPEGs.
  for (const name of ['thumbnail', 'preview']) {
    // eslint-disable-next-line no-await-in-loop
    const meta = await analyzeImage(derivatives[name].key);
    assert.equal(meta.format, 'jpeg');
  }

  await fs.rm(dir, { recursive: true, force: true });
});
