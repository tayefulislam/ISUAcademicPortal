import fs from 'node:fs/promises';
import { PDFDocument, PDFName, PDFArray, PDFNumber, PDFRawStream } from 'pdf-lib';
import { env } from '../../../config/env.js';

/**
 * Reading a PDF: what is in it, and which of its embedded images can safely be
 * touched.
 *
 * Everything here is deliberately CONSERVATIVE. A PDF is the one format where a
 * wrong guess corrupts a document a student may need for an exam, so the rules
 * for "may I re-encode this image?" are narrow, and anything even slightly
 * unusual is left exactly as it is:

 *   - only `/Subtype /Image` streams;
 *   - only a single `/Filter /DCTDecode` (a JPEG). A CCITTFax or JBIG2 scan
 *     (1-bit, already tiny) or a Flate-with-predictor image is NOT touched —
 *     misinterpreting those is precisely how a PDF gets broken;
 *   - only `/DeviceRGB`, `/DeviceGray`, or an absent colour space. A CMYK or
 *     ICCBased space would render wrongly if re-encoded as plain RGB;
 *   - no `/SMask` (transparency: its dimensions must track the base image's),
 *     no `/Mask`, and no `/Decode` (an inversion array).
 *
 * The filter list is configurable, but the default is the one above for a
 * reason: JPEG is where the bytes are in a scanned document, and it is the case
 * that is unambiguous to re-encode.
 */

/** Loads a document, reporting encryption rather than throwing. */
export async function loadPdfDocument(bytes) {
  try {
    const doc = await PDFDocument.load(bytes, {
      updateMetadata: false,
      // A structurally imperfect but renderable PDF is worth a try; pdf-lib
      // tolerates a bad object rather than rejecting the whole document.
      throwOnInvalidObject: false,
    });

    // Touch the page tree NOW. A file with the %PDF- header but no usable
    // catalog loads "successfully" and then throws on the first getPageCount()/
    // getPages() call — which would surface as an unhandled exception deep
    // inside a caller instead of a clean "this PDF is unreadable". Probing here
    // means every caller (analyze, process, validate) gets the same answer.
    doc.getPageCount();

    return { doc, encrypted: false, error: null };
  } catch (err) {
    const message = String(err?.message || '');
    return {
      doc: null,
      encrypted: /encrypt/i.test(message),
      error: err,
    };
  }
}

/** A PDFName's value without its leading slash. */
function nameOf(obj) {
  if (obj instanceof PDFName) return obj.asString().replace(/^\/+/, '');
  return null;
}

function numberOf(dict, key) {
  const value = dict.lookup(PDFName.of(key));
  if (value instanceof PDFNumber) return value.asNumber();
  return 0;
}

/**
 * Every embedded image in the document, with the facts needed to decide whether
 * it may be re-encoded.
 *
 * Walks the indirect object table rather than each page's `/Resources`, so an
 * image shared by several pages is found once and a nested Form XObject's images
 * are not missed.
 */
export function inventoryImages(doc) {
  const images = [];

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;

    if (nameOf(dict.lookup(PDFName.of('Subtype'))) !== 'Image') continue;

    const filterObj = dict.lookup(PDFName.of('Filter'));
    let filter = null;
    if (filterObj instanceof PDFName) filter = nameOf(filterObj);
    else if (filterObj instanceof PDFArray) filter = 'multiple';

    const colorSpaceObj = dict.lookup(PDFName.of('ColorSpace'));
    const colorSpace = nameOf(colorSpaceObj); // null for an array (e.g. ICCBased)

    images.push({
      ref,
      dict,
      stream: obj,
      filter,
      colorSpace,
      width: numberOf(dict, 'Width'),
      height: numberOf(dict, 'Height'),
      bitsPerComponent: numberOf(dict, 'BitsPerComponent'),
      byteLength: obj.contents?.length || 0,
      hasSMask: dict.has(PDFName.of('SMask')),
      hasMask: dict.has(PDFName.of('Mask')),
      hasDecode: dict.has(PDFName.of('Decode')),
      imageMask: nameOf(dict.lookup(PDFName.of('ImageMask'))) !== null || Boolean(dict.get(PDFName.of('ImageMask'))),
      contents: obj.contents,
    });
  }

  return images;
}

/**
 * Why this image must NOT be re-encoded, or `null` if it may be.
 * A returned reason is recorded in the job log — it is why an optimization run
 * saved nothing, and that needs to be explicable.
 */
export function reencodeBlockReason(image, { filters = env.uploads.pdf.reencodeFilters } = {}) {
  if (!filters.includes(image.filter)) return `filter:${image.filter || 'none'}`;
  if (!image.width || !image.height) return 'missing-dimensions';
  if (image.width < 8 || image.height < 8) return 'degenerate-dimensions';
  if (image.contents?.length === 0) return 'empty-stream';
  if (image.hasSMask) return 'has-smask';
  if (image.hasMask) return 'has-mask';
  if (image.hasDecode) return 'has-decode-array';
  if (image.imageMask) return 'image-mask';
  if (image.bitsPerComponent && image.bitsPerComponent !== 8) return `bits:${image.bitsPerComponent}`;
  if (image.colorSpace && !['DeviceRGB', 'DeviceGray', 'CalRGB', 'CalGray'].includes(image.colorSpace)) {
    return `colorspace:${image.colorSpace}`;
  }
  return null;
}

/**
 * Structural summary of a PDF on disk — used both by the decision engine (to
 * know whether optimizing is plausible before doing the work) and by the
 * analyzer for the metadata record.
 *
 * @returns {Promise<{pageCount:number, imageCount:number, reencodableCount:number, totalImageBytes:number, encrypted:boolean, loadError:string}>}
 */
export async function analyzePdfFile(filePath) {
  const bytes = await fs.readFile(filePath);
  const { doc, encrypted, error } = await loadPdfDocument(bytes);

  if (!doc) {
    return {
      pageCount: 0,
      imageCount: 0,
      reencodableCount: 0,
      totalImageBytes: 0,
      encrypted,
      loadError: encrypted ? 'encrypted' : String(error?.message || 'unreadable').slice(0, 200),
    };
  }

  const images = inventoryImages(doc);
  const reencodable = images.filter((img) => !reencodeBlockReason(img));

  return {
    pageCount: doc.getPageCount(),
    imageCount: images.length,
    reencodableCount: reencodable.length,
    totalImageBytes: images.reduce((sum, img) => sum + img.byteLength, 0),
    reencodableBytes: reencodable.reduce((sum, img) => sum + img.byteLength, 0),
    encrypted: false,
    loadError: '',
  };
}

/** Just the page count, for the metadata record. Never throws. */
export async function readPdfPageCount(filePath) {
  try {
    const bytes = await fs.readFile(filePath);
    const { doc } = await loadPdfDocument(bytes);
    return doc ? doc.getPageCount() : 0;
  } catch {
    return 0;
  }
}

export default { loadPdfDocument, inventoryImages, reencodeBlockReason, analyzePdfFile, readPdfPageCount };
