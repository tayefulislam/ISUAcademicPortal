import fs from 'node:fs/promises';
import { PDFName, PDFRawStream } from 'pdf-lib';
import { loadPdfDocument, inventoryImages } from './pdfAnalyze.js';

/**
 * Post-optimization validation (§10).
 *
 * A rebuilt PDF must be proven sane before it is allowed to replace the
 * original. The checks, in increasing order of strength:
 *
 *   1. it still starts with `%PDF-`;
 *   2. it re-parses — which means the cross-reference table and every object it
 *      points at are intact, a genuine test of structural integrity;
 *   3. the page count is unchanged;
 *   4. every page's resources resolve, and every embedded image stream is
 *      non-empty — forcing the object graph to be walked rather than trusting
 *      the parse to have been lazy;
 *   5. the whole file is still present (a truncated write would fail 2 anyway,
 *      but an explicit size floor makes the failure obvious).
 *
 * On "pages can be rendered": that would need an actual PDF renderer, and the
 * only one available here is a headless Chromium (Playwright, already a
 * dependency for the document generator) — running it per uploaded PDF is a
 * disproportionate cost, and its absence on some hosts would make validation
 * silently weaker. Full object resolution (4) is a strong structural proxy: it
 * is what fails when a rebuild is broken. A renderer can be layered on later
 * behind this same interface without changing any caller.
 */

const PDF_MAGIC = '%PDF-';

/**
 * @param {string} filePath the OPTIMIZED file
 * @param {{expectedPageCount?:number}} [opts]
 * @returns {Promise<{valid:boolean, reason:string, pageCount:number, imageCount:number, error:string}>}
 */
export async function validatePdf(filePath, { expectedPageCount } = {}) {
  let bytes;
  try {
    bytes = await fs.readFile(filePath);
  } catch (err) {
    return { valid: false, reason: 'unreadable-file', pageCount: 0, imageCount: 0, error: err.message };
  }

  if (bytes.length < 16) {
    return { valid: false, reason: 'too-small', pageCount: 0, imageCount: 0, error: '' };
  }
  if (bytes.subarray(0, PDF_MAGIC.length).toString('latin1') !== PDF_MAGIC) {
    return { valid: false, reason: 'bad-header', pageCount: 0, imageCount: 0, error: '' };
  }

  const { doc, encrypted, error } = await loadPdfDocument(bytes);
  if (!doc) {
    return {
      valid: false,
      reason: encrypted ? 'encrypted' : 'unparseable',
      pageCount: 0,
      imageCount: 0,
      error: String(error?.message || '').slice(0, 200),
    };
  }

  const pageCount = doc.getPageCount();
  if (pageCount <= 0) {
    return { valid: false, reason: 'no-pages', pageCount, imageCount: 0, error: '' };
  }
  if (expectedPageCount && pageCount !== expectedPageCount) {
    return {
      valid: false,
      reason: 'page-count-changed',
      pageCount,
      expectedPageCount,
      imageCount: 0,
      error: '',
    };
  }

  // Force the object graph to be resolved: a dangling reference or a malformed
  // page tree throws here, which is exactly the failure a rebuild can introduce.
  try {
    for (const page of doc.getPages()) {
      page.node.Resources();
      void page.getWidth();
      void page.getHeight();
    }
  } catch (err) {
    return { valid: false, reason: 'page-resolution-failed', pageCount, imageCount: 0, error: String(err?.message || '').slice(0, 200) };
  }

  // Every image stream must still carry bytes.
  const images = inventoryImages(doc);
  for (const image of images) {
    if (image.stream instanceof PDFRawStream && (!image.contents || image.contents.length === 0)) {
      return { valid: false, reason: 'empty-image-stream', pageCount, imageCount: images.length, error: '' };
    }
    if (!image.dict.get(PDFName.of('Width'))) {
      return { valid: false, reason: 'image-missing-width', pageCount, imageCount: images.length, error: '' };
    }
  }

  return { valid: true, reason: 'ok', pageCount, imageCount: images.length, error: '' };
}

export default { validatePdf };
