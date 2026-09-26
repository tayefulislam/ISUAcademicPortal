#!/usr/bin/env node
/**
 * Compression self-check.
 *
 * Answers one question with no ambiguity: does this server's compression engine
 * actually work? It runs the REAL pipeline — detection, decision engine,
 * processor, validation, size comparison — on a file it builds itself, so it
 * needs no Redis, no queue, no upload, no token and no MongoDB.
 *
 *   node scripts/checkCompression.js                    # built-in sample PDF
 *   node scripts/checkCompression.js /path/to/scan.pdf  # or a file of your own
 *
 * Run it FROM THE SERVER DIRECTORY, so `.env` is read:
 *
 *   cd ~/ISUAcademicPortal/server && node scripts/checkCompression.js
 *
 * Exits 0 when the engine works, 1 when it is disabled or fails. A file that
 * correctly needs no work (a ZIP, a JPEG, a text-only PDF) is a PASS, not a
 * failure — deciding that is half of what the engine does.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

import { env } from '../src/config/env.js';
import { analyzeFile, determineOptimizationStrategy } from '../src/services/uploads/processing/decisionEngine.js';
import { isWorthKeeping } from '../src/services/uploads/processing/compareSizes.js';
import { processImage } from '../src/services/uploads/image/imageProcessor.js';
import { processPdf } from '../src/services/uploads/pdf/pdfProcessor.js';
import { validatePdf } from '../src/services/uploads/pdf/pdfValidate.js';
import { compressFile, resolveCodec } from '../src/services/uploads/compression/compressStream.js';

const MB = 1024 * 1024;
const mb = (bytes) => `${(bytes / MB).toFixed(2)} MB`;
const onOff = (value) => (value ? 'on' : 'OFF');

/**
 * A PDF of full-page scanned-style images — the shape of the file this system
 * exists for. Noise, so it compresses; a flat colour would not.
 */
async function buildSamplePdf(file, { pages = 4, width = 2600, height = 3400 } = {}) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      raw[i] = (x * 7 + y * 13) % 256;
      raw[i + 1] = (x * 29 + y * 3) % 256;
      raw[i + 2] = (x * 11 + y * 97) % 256;
    }
  }
  const jpeg = await sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();

  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(jpeg);
  for (let p = 0; p < pages; p += 1) {
    doc.addPage([595, 842]).drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
  }
  await fs.writeFile(file, await doc.save());
}

async function main() {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'compress-check-'));
  const target = process.argv[2];

  console.log('=== Compression self-check ===');
  console.log(
    `optimization: ${env.uploads.optimization.enabled ? 'ENABLED' : 'DISABLED'}`
      + `  |  images: ${onOff(env.uploads.optimization.images)}`
      + `  pdf: ${onOff(env.uploads.optimization.pdf)}`
      + `  text: ${onOff(env.uploads.optimization.text)}`
  );
  console.log(`pdf profile: ${env.uploads.optimization.defaultPdfProfile}  |  text codec: ${resolveCodec()}`);
  console.log(`keep-original rule: needs both >${mb(env.uploads.optimization.minSavingBytes)} and >${env.uploads.optimization.minSavingPercent}%`);
  console.log('');

  if (!env.uploads.optimization.enabled) {
    console.error('RESULT: NOT WORKING — optimization is switched off (UPLOAD_OPTIMIZE_ENABLED / UPLOADS_ENABLED).');
    process.exitCode = 1;
    return;
  }

  const input = target ? path.resolve(target) : path.join(work, 'sample.pdf');
  if (target) {
    const stat = await fs.stat(input).catch(() => null);
    if (!stat) {
      console.error(`RESULT: NOT WORKING — no such file: ${input}`);
      process.exitCode = 1;
      return;
    }
    console.log(`input: ${input} (${mb(stat.size)})`);
  } else {
    await buildSamplePdf(input);
    console.log(`input: built a test PDF — 4 full-page scanned-style images (${mb((await fs.stat(input)).size)})`);
    console.log('       (pass a path as an argument to check a real file instead)');
  }
  console.log('');

  const { size: originalSize } = await fs.stat(input);
  const analysis = await analyzeFile({
    filePath: input,
    originalName: path.basename(input),
    size: originalSize,
  });

  console.log(`detected : ${analysis.label} — ${analysis.mime} [${analysis.category}] via ${analysis.source}`);
  if (analysis.pageCount) {
    console.log(`           ${analysis.pageCount} page(s), ${analysis.imageCount} embedded image(s), `
      + `${analysis.reencodableImageCount} re-encodable`);
  }

  const decision = determineOptimizationStrategy(analysis);
  console.log(`strategy : ${decision.strategy}${decision.profile ? ` (profile ${decision.profile})` : ''} — ${decision.reason}`);
  console.log('');

  if (decision.strategy === 'reject') {
    console.error('RESULT: NOT WORKING — the file was refused as unsafe, so nothing would be stored.');
    process.exitCode = 1;
    return;
  }

  if (decision.strategy === 'none') {
    console.log('RESULT: ENGINE OK — this file correctly needs no work.');
    console.log('        (Nothing would be rewritten, which is the intended outcome for an already-optimal format.)');
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    return;
  }

  const started = Date.now();
  const out = path.join(work, `out.${analysis.ext || 'bin'}`);
  let note = '';

  if (decision.strategy === 'pdf-optimize') {
    const result = await processPdf(input, out, { profile: decision.profile });
    if (!result.ok) {
      console.error(`RESULT: NOT WORKING — the PDF rebuild was declined: ${result.reason}`);
      process.exitCode = 1;
      return;
    }
    const validation = await validatePdf(out, { expectedPageCount: analysis.pageCount });
    if (!validation.valid) {
      console.error(`RESULT: NOT WORKING — the rebuilt PDF failed validation: ${validation.reason}`);
      process.exitCode = 1;
      return;
    }
    note = `re-encoded ${result.reencoded} image(s), page count preserved (${validation.pageCount})`;
  } else if (decision.strategy === 'image-optimize') {
    const result = await processImage(input, out, {});
    note = `${result.format} ${result.width}x${result.height}`;
  } else if (decision.strategy === 'text-compress') {
    const result = await compressFile(input, out, resolveCodec());
    note = `${result.codec}`;
  }

  const storedSize = (await fs.stat(out)).size;
  const worth = isWorthKeeping(originalSize, storedSize);

  console.log(`processed: ${note} in ${Date.now() - started} ms`);
  console.log(`original : ${mb(originalSize)}`);
  console.log(`optimized: ${mb(storedSize)}`);
  console.log('');

  if (worth.keep) {
    console.log(`RESULT: WORKING — would store the optimized file, saving ${mb(worth.savedBytes)} (${worth.savedPercentage}%).`);
  } else {
    console.log(`RESULT: WORKING — engine ran fine, but keeps the original (${worth.reason}).`);
    console.log('        That is the size guard doing its job, not a failure.');
  }

  await fs.rm(work, { recursive: true, force: true }).catch(() => {});
}

main().catch((err) => {
  console.error('RESULT: NOT WORKING — the check threw:');
  console.error(err);
  process.exitCode = 1;
});
