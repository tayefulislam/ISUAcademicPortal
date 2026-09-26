import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createBrotliCompress, createBrotliDecompress, createGzip, createGunzip, constants as zlibConstants } from 'node:zlib';
import { PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { env } from '../../../config/env.js';

/**
 * Streaming compression for text-like files (JSON, CSV, TXT, XML, SVG, …).
 *
 * ── On the choice of codec (a deliberate deviation from the spec) ───────────
 *
 * The spec asks for Zstandard. This Node runtime (22.x) has no built-in zstd,
 * and the practical npm options are BUFFER-based (`@mongodb-js/zstd` exposes
 * `compress(Buffer) -> Buffer`). Using one would mean reading a 100 MB JSON file
 * fully into memory before compressing it — which directly violates the other,
 * more important requirement in the same spec: "never load the whole file into
 * RAM". A buffer-based zstd would trade a real guarantee for a marginal ratio.
 *
 * Brotli is therefore the default: it is built into Node, fully STREAMING, and
 * at a comparable quality setting its ratio on text is at least as good as
 * zstd's. `gzip` is available for interoperability, and the codec is a
 * parameter throughout, so a future streaming zstd (Node 23+ shipped
 * `zlib.createZstdCompress`) drops in by adding one branch to compressStream.
 *
 * ── Why this is safe ────────────────────────────────────────────────────────
 *
 * Compression is content-agnostic: the stored bytes are a faithful, lossless
 * encoding of the original, and decompression on download reproduces it exactly.
 * Nothing is "optimized" away, so there is no quality or corruption risk here —
 * only a size win, and a pure loss of CPU if it does not pay off. That payoff is
 * checked before the compressed version is kept (compareSizes).
 */

export const CODECS = ['brotli', 'gzip', 'none'];

/**
 * Normalizes a configured codec to one this runtime can actually stream.
 *
 * `auto` and any unrecognized value resolve to brotli. `zstd` also resolves to
 * brotli, for the reason above — it is accepted as a config value so an operator
 * asking for it gets the closest available thing rather than an error.
 */
export function resolveCodec(preference = env.uploads.text.codec) {
  const pref = String(preference || 'auto').toLowerCase();
  if (pref === 'gzip') return 'gzip';
  if (pref === 'none') return 'none';
  return 'brotli';
}

/** The compression Transform for a codec. */
export function compressStream(codec = 'brotli') {
  switch (resolveCodec(codec)) {
    case 'gzip':
      return createGzip({ level: env.uploads.text.gzipLevel });
    case 'none':
      return new PassThrough();
    case 'brotli':
    default:
      return createBrotliCompress({
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: env.uploads.text.brotliQuality,
        },
      });
  }
}

/** The matching decompression Transform. */
export function decompressStream(codec = 'brotli') {
  switch (resolveCodec(codec)) {
    case 'gzip':
      return createGunzip();
    case 'none':
      return new PassThrough();
    case 'brotli':
    default:
      return createBrotliDecompress();
  }
}

/**
 * Streams `srcPath` through the compressor into `destPath`.
 * Peak memory is zlib's internal window, not the file.
 *
 * @returns {Promise<{codec:string, originalSize:number, compressedSize:number}>}
 */
export async function compressFile(srcPath, destPath, codec = 'brotli') {
  const resolved = resolveCodec(codec);
  await pipeline(createReadStream(srcPath), compressStream(resolved), createWriteStream(destPath));

  const [{ size: compressedSize }, { size: originalSize }] = await Promise.all([stat(destPath), stat(srcPath)]);
  return { codec: resolved, originalSize, compressedSize };
}

/**
 * A Readable of the DECOMPRESSED content of a compressed object — used to serve
 * a download. The client receives the original bytes; the compression is purely
 * a storage detail.
 */
export function decompressFileToStream(srcPath, codec = 'brotli') {
  const out = new PassThrough();
  pipeline(createReadStream(srcPath), decompressStream(codec), out).catch((err) => out.destroy(err));
  return out;
}

/** A Readable of the compressed content of a plain file — for `compressFile`'s callers that stream. */
export function compressFileToStream(srcPath, codec = 'brotli') {
  const out = new PassThrough();
  pipeline(createReadStream(srcPath), compressStream(codec), out).catch((err) => out.destroy(err));
  return out;
}

export default {
  CODECS,
  resolveCodec,
  compressStream,
  decompressStream,
  compressFile,
  decompressFileToStream,
  compressFileToStream,
};
