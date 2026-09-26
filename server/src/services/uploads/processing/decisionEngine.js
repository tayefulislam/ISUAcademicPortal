import { detectFileTypeFromPath } from '../detection/detectFileType.js';
import { analyzeImage, isProcessableImage } from '../image/imageProcessor.js';
import { analyzePdfFile } from '../pdf/pdfAnalyze.js';
import { resolveProfile } from '../pdf/pdfProfiles.js';
import { mustStoreOriginal } from '../document/archiveGuard.js';
import { env } from '../../../config/env.js';

/**
 * The decision engine (§3).
 *
 *     detectFileType -> analyzeFile -> determineOptimizationStrategy
 *
 * Its whole purpose is the spec's central negative requirement: the system must
 * NOT blindly compress everything. A ZIP, an MP4, an already-optimized JPEG and
 * a 4 KB text file all have exactly one correct processing cost — zero — and this
 * is where that call is made, before any CPU is spent.
 *
 * The analysis is also the metadata the model records, so nothing here is
 * throwaway work: MIME, extension, size, magic bytes, whether the format is
 * already compressed, whether optimization is safe, and the recommended method.
 */

/** The strategy vocabulary. `reject` is the only one that refuses an upload. */
export const STRATEGIES = ['none', 'image-optimize', 'pdf-optimize', 'text-compress', 'reject'];

/**
 * Gathers every fact about a file needed to decide what to do with it.
 *
 * Type comes from magic bytes (never the client's claim), and cheap structural
 * facts are gathered per family — image dimensions, PDF page/image counts — so
 * the record is useful even when the answer is "store it unchanged".
 *
 * @param {{filePath:string, originalName?:string, clientMime?:string, size?:number, profile?:string}} input
 */
export async function analyzeFile({ filePath, originalName = '', clientMime = '', size = 0, profile }) {
  const detection = await detectFileTypeFromPath(filePath, { originalName, clientMime });

  const analysis = {
    filePath,
    originalName,
    clientMime,
    size: Number(size) || 0,
    ...detection,
    // Structural facts, filled in below where they apply.
    pageCount: 0,
    width: 0,
    height: 0,
    imageCount: 0,
    reencodableImageCount: 0,
    animated: false,
    optimizationSafe: true,
    unsafeReason: '',
  };

  try {
    if (detection.category === 'image' && detection.ext !== 'svg') {
      const meta = await analyzeImage(filePath);
      analysis.width = meta.width;
      analysis.height = meta.height;
      analysis.animated = (meta.pages || 1) > 1;
      // A multi-frame image (animated GIF/WebP) must not be flattened — that
      // would silently destroy the animation.
      analysis.imageFormat = meta.format;
      if (!isProcessableImage(meta)) {
        analysis.optimizationSafe = false;
        analysis.unsafeReason = analysis.animated ? 'animated' : `format:${meta.format || 'unknown'}`;
      }
    } else if (detection.ext === 'pdf') {
      const pdf = await analyzePdfFile(filePath);
      analysis.pageCount = pdf.pageCount;
      analysis.imageCount = pdf.imageCount;
      analysis.reencodableImageCount = pdf.reencodableCount;
      if (pdf.encrypted || pdf.loadError) {
        analysis.optimizationSafe = false;
        analysis.unsafeReason = pdf.encrypted ? 'encrypted' : pdf.loadError;
      } else if (filePath && Number(size) > env.uploads.pdf.maxOptimizeMb * 1024 * 1024) {
        analysis.optimizationSafe = false;
        analysis.unsafeReason = 'too-large-to-optimize';
      }
    }
  } catch (err) {
    // A file whose structure cannot be read is still storable — it is simply
    // not optimizable. Failing the whole upload over it would be worse.
    analysis.optimizationSafe = false;
    analysis.unsafeReason = `analysis-failed:${String(err?.message || '').slice(0, 80)}`;
  }

  analysis.profile = resolveProfile(profile).name;
  return analysis;
}

/**
 * Chooses the processing method for an analysis.
 *
 * @returns {{strategy:string, reason:string, profile:string}}
 */
export function determineOptimizationStrategy(analysis, { profile } = {}) {
  const resolvedProfile = resolveProfile(profile || analysis?.profile).name;
  const deny = (reason) => ({ strategy: 'none', reason, profile: resolvedProfile });

  if (!analysis) return deny('no-analysis');

  // 1. Policy: an executable is refused outright, before anything else.
  if (analysis.dangerous) {
    return { strategy: 'reject', reason: `dangerous:${analysis.ext || 'binary'}`, profile: resolvedProfile };
  }

  // 2. The master switch. Off means every file is stored exactly as uploaded.
  if (!env.uploads.optimization.enabled) return deny('optimization-disabled');

  // 3. A format we cannot safely rewrite is never rewritten.
  if (!analysis.optimizationSafe) return deny(`unsafe:${analysis.unsafeReason || 'unknown'}`);

  if (analysis.category === 'video') return deny('video-not-transcoded');
  if (analysis.category === 'audio') return deny('audio-not-transcoded');
  if (analysis.category === 'archive') return deny('archive-stored-as-is');
  if (mustStoreOriginal(analysis.ext)) return deny('already-compressed');

  // 4. Family-specific strategies.
  if (analysis.ext === 'pdf') {
    if (!env.uploads.optimization.pdf) return deny('pdf-optimization-disabled');
    if (env.uploads.pdf.skipWhenNoImages && !analysis.reencodableImageCount) {
      return deny('pdf-has-no-reencodable-images');
    }
    return { strategy: 'pdf-optimize', reason: 'pdf-images', profile: resolvedProfile };
  }

  if (analysis.category === 'image' && analysis.ext !== 'svg') {
    if (!env.uploads.optimization.images) return deny('image-optimization-disabled');

    // Reconciling §4 with §8: an image is NOT re-encoded merely because we can.
    //
    // §8 lists JPEG and "highly compressed PNG" among the files that must not be
    // wastefully re-processed — re-compressing an already-optimized JPEG costs
    // CPU and quality for a few percent. §4, though, says to resize an image
    // whose dimensions are unnecessarily large, and THAT is a real win.
    //
    // So: a format with built-in compression (JPEG/PNG/WebP/GIF) is touched only
    // when its long edge exceeds the configured ceiling. A format without it
    // (TIFF, BMP — typically enormous and not web-displayable) is always worth
    // converting.
    const longEdge = Math.max(Number(analysis.width) || 0, Number(analysis.height) || 0);
    const oversized = longEdge > env.uploads.image.maxDimension;
    if (analysis.alreadyCompressed && !oversized) return deny('image-already-optimized');

    return {
      strategy: 'image-optimize',
      reason: oversized ? 'image-resize' : 'image-reencode',
      profile: resolvedProfile,
    };
  }

  // 5. Text-like content (including SVG, which is XML) — the one place a
  //    general-purpose codec genuinely helps.
  if (analysis.textLike || analysis.ext === 'svg') {
    if (!env.uploads.optimization.text) return deny('text-compression-disabled');
    if (analysis.size && analysis.size < env.uploads.text.minSizeBytes) return deny('below-text-size-floor');
    return { strategy: 'text-compress', reason: 'text-stream', profile: resolvedProfile };
  }

  // 6. Anything already compressed that slipped past the ext check, and
  //    everything unknown, is stored untouched.
  if (analysis.alreadyCompressed) return deny('already-compressed');
  return deny('no-strategy');
}

export default { STRATEGIES, analyzeFile, determineOptimizationStrategy };
