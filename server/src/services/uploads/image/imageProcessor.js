import sharp from 'sharp';
import path from 'node:path';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

/**
 * Image optimization (spec §4).
 *
 * Uses sharp (libvips), which decodes into native memory rather than the V8
 * heap and streams from a file path — so a 60 MP photo does not blow up RSS the
 * way a Buffer-based decode would.
 *
 * The governing rule from the spec is "do not reduce image quality
 * unnecessarily", and for academic material specifically "if an image contains
 * text, avoid aggressive compression". That is implemented as a real heuristic
 * (below) rather than a fixed quality, and it is deliberately biased toward
 * QUALITY when it cannot tell — a slightly larger scan of a textbook page is a
 * much better failure mode than an unreadable one.
 */

// Above this many pixels, sharp's stats() (a full decode to gather per-channel
// statistics) is not worth the CPU, so the text heuristic is skipped and the
// image is treated conservatively instead.
const STATS_PIXEL_BUDGET = 40_000_000;

/** Formats sharp can decode. Anything else is stored untouched. */
const DECODABLE = new Set(['jpeg', 'png', 'webp', 'tiff', 'bmp', 'gif', 'avif', 'heif', 'svg']);

/**
 * Whether sharp can work with this format at all.
 * An animated GIF is excluded on purpose: re-encoding it frame-by-frame is
 * expensive and easy to get wrong, and it is already compressed anyway.
 */
export function isProcessableImage(meta) {
  if (!meta || !DECODABLE.has(meta.format)) return false;
  if (meta.pages && meta.pages > 1) return false;
  return true;
}

/** Reads structural metadata without a full pixel decode. */
export async function analyzeImage(filePath) {
  const meta = await sharp(filePath, { failOn: 'none' }).metadata();
  return {
    width: meta.width || 0,
    height: meta.height || 0,
    format: meta.format || '',
    space: meta.space || '',
    hasAlpha: Boolean(meta.hasAlpha),
    pages: meta.pages || 1,
    megapixels: ((meta.width || 0) * (meta.height || 0)) / 1_000_000,
  };
}

/**
 * The text/line-art heuristic.
 *
 * A scanned page or a screenshot of text is, statistically: near-greyscale,
 * dominated by a couple of colours (black and white), and strongly bimodal —
 * which shows up as a large per-channel standard deviation. A photograph is
 * none of those things.
 *
 * Returns `{ textLike, confident }`. When `confident` is false the caller uses
 * the SAFE quality floor, never the aggressive one.
 */
export function classifyImage(meta, stats) {
  if (!stats || !stats.channels?.length) return { textLike: false, confident: false };
  if ((meta.width || 0) * (meta.height || 0) > STATS_PIXEL_BUDGET) {
    return { textLike: false, confident: false };
  }

  const channels = stats.channels;
  let greyscale = false;
  if (channels.length >= 3) {
    const means = channels.slice(0, 3).map((c) => c.mean);
    greyscale = Math.max(...means) - Math.min(...means) < 12;
  } else {
    greyscale = true; // a single-channel image is greyscale by definition
  }

  const fewColours = (stats.dominant?.length ?? 0) <= 3;
  // Black-on-white text has a large spread; a greyscale photo does not.
  const bimodal = (channels[0]?.stdev ?? 0) > 45;

  return { textLike: greyscale && fewColours && bimodal, confident: true };
}

/**
 * Chooses the output format.
 *
 * Animated/lossless-sensitive formats are left alone; a JPEG stays a JPEG
 * (re-encoding to WebP would change the extension a client may rely on unless
 * explicitly permitted); a TIFF/BMP — which is typically enormous and is not
 * web-displayable — becomes a JPEG, which is where the biggest legitimate wins
 * on scanned material come from.
 */
function chooseOutputFormat(meta, { allowWebp }) {
  if (meta.format === 'webp') return { format: 'webp', extension: 'webp', mimeType: 'image/webp' };
  if (meta.format === 'png') {
    // A PNG with alpha must keep a format that has an alpha channel.
    if (meta.hasAlpha) return { format: 'png', extension: 'png', mimeType: 'image/png' };
    if (allowWebp) return { format: 'webp', extension: 'webp', mimeType: 'image/webp' };
    return { format: 'jpeg', extension: 'jpg', mimeType: 'image/jpeg' };
  }
  if (meta.format === 'tiff' || meta.format === 'bmp') {
    if (meta.hasAlpha && allowWebp) return { format: 'webp', extension: 'webp', mimeType: 'image/webp' };
    return { format: 'jpeg', extension: 'jpg', mimeType: 'image/jpeg' };
  }
  return { format: 'jpeg', extension: 'jpg', mimeType: 'image/jpeg' };
}

/**
 * Optimizes an image from `filePath` into `outputPath`.
 *
 * @returns {Promise<{width:number, height:number, format:string, mimeType:string, extension:string, textLike:boolean}>}
 */
export async function processImage(filePath, outputPath, options = {}) {
  const cfg = env.uploads.image;
  const maxDimension = Number(options.maxDimension) || cfg.maxDimension;
  const allowWebp = options.allowWebp ?? cfg.allowWebpConversion;

  const meta = await analyzeImage(filePath);

  // Gather statistics only when the heuristic can actually use them.
  let stats = null;
  if ((meta.width || 0) * (meta.height || 0) <= STATS_PIXEL_BUDGET) {
    try {
      stats = await sharp(filePath, { failOn: 'none', pages: 1 }).stats();
    } catch (err) {
      // A damaged-but-decodable image still gets optimized; we just cannot
      // classify it, and the safe floor applies.
      logger.warn(`[uploads] could not compute image stats: ${err.message}`, { source: 'imageProcessor.stats' });
    }
  }

  const { textLike, confident } = classifyImage(meta, stats);
  // The safety rule: an unclassifiable image is treated as though it may contain
  // text, so it never receives the aggressive quality.
  const treatAsText = textLike || !confident;

  const quality = treatAsText ? cfg.textSafeQuality : cfg.jpegQuality;
  const webpQuality = treatAsText ? Math.max(cfg.webpQuality, 85) : cfg.webpQuality;
  const out = chooseOutputFormat(meta, { allowWebp });

  let pipeline = sharp(filePath, { failOn: 'none', pages: 1 }).rotate(); // honour EXIF orientation

  // `withoutEnlargement` guarantees a small image is never upscaled — resizing
  // is only ever a reduction.
  const needsResize = (meta.width || 0) > maxDimension || (meta.height || 0) > maxDimension;
  if (needsResize) {
    pipeline = pipeline.resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true });
  }

  // A gentle sharpen preserves legibility of small text when a scan has been
  // downscaled — the difference between "smaller" and "unreadable".
  if (treatAsText && needsResize && cfg.textSafeSharpen) {
    pipeline = pipeline.sharpen({ sigma: 0.6 });
  }

  if (out.format === 'jpeg') {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true, chromaSubsampling: treatAsText ? '4:4:4' : '4:2:0' });
  } else if (out.format === 'webp') {
    pipeline = pipeline.webp({ quality: webpQuality, effort: 4 });
  } else if (out.format === 'png') {
    pipeline = pipeline.png({ compressionLevel: cfg.pngCompressionLevel, palette: !meta.hasAlpha });
  }

  const info = await pipeline.toFile(outputPath);

  return {
    width: info.width || meta.width || 0,
    height: info.height || meta.height || 0,
    format: out.format,
    mimeType: out.mimeType,
    extension: out.extension,
    textLike,
  };
}

/**
 * Generates the thumbnail + preview derivatives (§4), so the Android client can
 * render a small image before the full one.
 *
 * Best-effort by design: a derivative failure must never fail the upload, so
 * each is caught and simply omitted.
 *
 * @returns {Promise<{thumbnail:object, preview:object}>}
 */
export async function generateImageDerivatives(filePath, outDir) {
  const cfg = env.uploads.image;
  const result = { thumbnail: {}, preview: {} };

  const specs = [
    ['thumbnail', cfg.thumbnailWidth, 70],
    ['preview', cfg.previewWidth, 78],
  ];

  for (const [name, width, quality] of specs) {
    const key = path.join(outDir, `${name}.jpg`);
    try {
      // eslint-disable-next-line no-await-in-loop
      const info = await sharp(filePath, { failOn: 'none', pages: 1 })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toFile(key);
      result[name] = {
        key,
        width: info.width || 0,
        height: info.height || 0,
        sizeBytes: info.size || 0,
        mimeType: 'image/jpeg',
      };
    } catch (err) {
      logger.warn(`[uploads] could not generate ${name}: ${err.message}`, { source: 'imageProcessor.derivatives' });
    }
  }

  return result;
}

export default {
  isProcessableImage,
  analyzeImage,
  classifyImage,
  processImage,
  generateImageDerivatives,
};
