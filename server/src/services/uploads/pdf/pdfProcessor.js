import fs from 'node:fs/promises';
import sharp from 'sharp';
import { PDFName, PDFNumber, PDFRawStream } from 'pdf-lib';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { resolveProfile } from './pdfProfiles.js';
import { loadPdfDocument, inventoryImages, reencodeBlockReason } from './pdfAnalyze.js';

/**
 * PDF optimization (spec §5).
 *
 * The approach: parse the document, find the embedded images that are safe to
 * touch (see pdfAnalyze for the narrow rules), re-encode each one — downscaling
 * to the profile's pixel ceiling and re-compressing as JPEG — then rebuild the
 * PDF and let the pipeline decide whether the result is actually smaller.
 *
 * What is deliberately NOT done:
 *   - no page is rasterized, so text, fonts, forms, annotations, links, and
 *     bookmarks are preserved exactly. This is not "print to image";
 *   - no image is ever replaced unless the NEW encoding is genuinely smaller
 *     than the one it displaces — so a single image can never make the file
 *     bigger;
 *   - pdf-lib saves with `updateFieldAppearances: false`, so AcroForm field
 *     appearance streams are not regenerated (which would silently alter a
 *     fillable form).
 *
 * Any failure at any step returns `{ ok: false, reason }`. The caller then keeps
 * the original — a PDF that could not be optimized is never a PDF that was
 * damaged.
 */

/**
 * Re-encodes one embedded image, or returns null when doing so is not a win.
 *
 * Baseline JPEG is used (mozjpeg off): progressive JPEG is legal in a PDF but is
 * not universally supported by older viewers, and embedding one is a needless
 * compatibility risk for a few percent.
 */
async function reencodeImage(image, profile) {
  const colorSpaceName = image.colorSpace || 'DeviceRGB';
  const greyscale = colorSpaceName === 'DeviceGray' || colorSpaceName === 'CalGray';

  const longEdge = Math.max(image.width, image.height);
  const needsResize = longEdge > profile.maxLongEdge;

  let pipe = sharp(Buffer.from(image.contents), { failOn: 'none' });
  if (needsResize) {
    pipe = pipe.resize({
      width: profile.maxLongEdge,
      height: profile.maxLongEdge,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  if (greyscale) pipe = pipe.greyscale();
  pipe = pipe.jpeg({ quality: profile.jpegQuality, mozjpeg: false, chromaSubsampling: '4:2:0' });

  const { data, info } = await pipe.toBuffer({ resolveWithObject: true });

  // The per-image keep-original rule: a replacement must earn its place.
  if (data.length >= image.byteLength) return null;

  return {
    bytes: data,
    width: info.width || image.width,
    height: info.height || image.height,
    colorSpaceName,
    bitsPerComponent: 8,
    resized: needsResize,
  };
}

/**
 * Optimizes a PDF from `filePath` into `outputPath`.
 *
 * @param {string} filePath
 * @param {string} outputPath
 * @param {{profile?:string}} [options]
 * @returns {Promise<{
 *   ok:boolean, reason:string, profile:string,
 *   pageCount:number, imageCount:number, reencoded:number, skipped:number,
 *   imageBytesBefore:number, imageBytesAfter:number, outputBytes:number
 * }>}
 */
export async function processPdf(filePath, outputPath, options = {}) {
  const cfg = env.uploads.pdf;
  const profile = resolveProfile(options.profile);

  const base = {
    ok: false,
    reason: '',
    profile: profile.name,
    pageCount: 0,
    imageCount: 0,
    reencoded: 0,
    skipped: 0,
    imageBytesBefore: 0,
    imageBytesAfter: 0,
    outputBytes: 0,
  };

  // Memory guard: pdf-lib needs the whole document resident. Above the ceiling
  // the file is stored as-is rather than risking the worker's heap.
  const stat = await fs.stat(filePath);
  if (stat.size > cfg.maxOptimizeMb * 1024 * 1024) {
    return { ...base, reason: 'too-large-to-optimize' };
  }

  const bytes = await fs.readFile(filePath);
  const { doc, encrypted, error } = await loadPdfDocument(bytes);
  if (!doc) {
    return { ...base, reason: encrypted ? 'encrypted' : 'unreadable', loadError: String(error?.message || '').slice(0, 200) };
  }

  // Everything from here on touches the document. The contract with the caller
  // is absolute — an unoptimizable PDF is DECLINED, never thrown — so the whole
  // rebuild is wrapped: a structural surprise must not fail the upload.
  try {
    const pageCountBefore = doc.getPageCount();
    const images = inventoryImages(doc);
    const candidates = images.filter((img) => !reencodeBlockReason(img));

    if (cfg.skipWhenNoImages && candidates.length === 0) {
      return { ...base, reason: 'no-reencodable-images', pageCount: pageCountBefore, imageCount: images.length };
    }

    let reencoded = 0;
    let skipped = 0;
    let imageBytesBefore = 0;
    let imageBytesAfter = 0;

    for (const image of candidates) {
      if (cfg.maxImages && reencoded >= cfg.maxImages) break;
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await reencodeImage(image, profile);
        if (!result) {
          skipped += 1;
          continue;
        }

        // Mutate the ORIGINAL dict in place, then hand the ref a new raw stream.
        // Reusing the dict preserves every key we did not deliberately change.
        const dict = image.dict;
        dict.set(PDFName.of('Width'), PDFNumber.of(result.width));
        dict.set(PDFName.of('Height'), PDFNumber.of(result.height));
        dict.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
        dict.set(PDFName.of('Length'), PDFNumber.of(result.bytes.length));
        dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(result.bitsPerComponent));
        if (result.colorSpaceName) dict.set(PDFName.of('ColorSpace'), PDFName.of(result.colorSpaceName));
        // A DecodeParms array (e.g. a ColorTransform) described the OLD encoding
        // and is meaningless — or actively harmful — for the new one.
        dict.delete(PDFName.of('DecodeParms'));

        doc.context.assign(image.ref, PDFRawStream.of(dict, new Uint8Array(result.bytes)));

        reencoded += 1;
        imageBytesBefore += image.byteLength;
        imageBytesAfter += result.bytes.length;
      } catch (err) {
        // One un-encodable image must not discard the work done on the others.
        skipped += 1;
        logger.warn(`[uploads] skipped a PDF image: ${err.message}`, { source: 'pdfProcessor.reencodeImage' });
      }
    }

    if (!reencoded) {
      return { ...base, reason: 'nothing-reencoded', pageCount: pageCountBefore, imageCount: images.length, skipped };
    }

    // Save WITHOUT touching form field appearances — regenerating them would
    // rewrite parts of the document the user did not ask us to change.
    const output = await doc.save({ updateFieldAppearances: false });
    await fs.writeFile(outputPath, output);

    return {
      ok: true,
      reason: 'optimized',
      profile: profile.name,
      pageCount: doc.getPageCount(),
      pageCountBefore,
      imageCount: images.length,
      reencoded,
      skipped,
      imageBytesBefore,
      imageBytesAfter,
      outputBytes: output.length,
    };
  } catch (err) {
    // A decline, not a failure — the caller keeps the original.
    logger.warn(`[uploads] PDF rebuild declined: ${err.message}`, { source: 'pdfProcessor' });
    return { ...base, reason: 'rebuild-error', loadError: String(err?.message || '').slice(0, 200) };
  }
}

export default { processPdf };
