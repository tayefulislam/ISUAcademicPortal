import { Transform } from 'node:stream';
import { ApiError } from '../../../utils/ApiError.js';
import { assertWithinLimit, limitBytesForCategory, prettyMb } from '../../../config/uploadLimits.js';

/**
 * Enforces a size cap on a STREAM, which is the only way to do it honestly.
 *
 * The client's `Content-Length` is a hint: it can be absent (a chunked request),
 * it can be wrong, and it can be a lie. A declared-size check is therefore an
 * early-rejection optimization, not the enforcement — this Transform is the
 * enforcement, because it counts the bytes that actually arrive and aborts the
 * moment the cap is passed. Because it is a Transform in a pipeline, aborting
 * also tears down the upload rather than letting the client keep streaming into
 * a discarded sink.
 */
export class SizeLimitStream extends Transform {
  /**
   * @param {number} limitBytes
   * @param {{category?:string}} [opts]
   */
  constructor(limitBytes, { category } = {}) {
    super();
    this.limitBytes = limitBytes;
    this.category = category || 'this';
    // The authoritative byte count for this upload.
    this.bytesCounted = 0;
  }

  _transform(chunk, _encoding, callback) {
    this.bytesCounted += chunk.length;
    if (this.bytesCounted > this.limitBytes) {
      callback(
        new ApiError(
          413,
          `File is too large: ${prettyMb(this.bytesCounted)} exceeds the ${prettyMb(this.limitBytes)} limit for ${this.category} files`,
          { category: this.category, limitBytes: this.limitBytes, receivedBytes: this.bytesCounted },
          'FILE_TOO_LARGE'
        )
      );
      return;
    }
    callback(null, chunk);
  }
}

/** A SizeLimitStream for the given category, sized from uploadLimits. */
export function createSizeLimitStream(category) {
  return new SizeLimitStream(limitBytesForCategory(category), { category });
}

export { assertWithinLimit, limitBytesForCategory, prettyMb };
export default { SizeLimitStream, createSizeLimitStream, assertWithinLimit, limitBytesForCategory, prettyMb };
