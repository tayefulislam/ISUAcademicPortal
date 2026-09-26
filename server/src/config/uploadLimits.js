import { env } from './env.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Single source of truth for "how big may a file of this kind be?".
 *
 * The legacy `env.maxFileSizeMb` bounds the RAM-buffering multer path and is
 * deliberately NOT consulted here — the streaming pipeline has its own
 * per-category caps, so a 4 GB video is allowed while a 4 GB image is not.
 *
 * Both the pre-flight check (before a byte is accepted) and the streaming
 * counter (while a byte is arriving) call into this module, so there is exactly
 * one place a limit can change.
 */

const MB = 1024 * 1024;

// A hard ceiling that outranks every category limit. Guards against a
// misconfigured env var (or a future category) turning the platform into an
// unbounded disk sink. 5 GB per the spec's "5 GB+" target, plus headroom.
export const HARD_MAX_BYTES = 6 * 1024 * MB; // 6 GiB

const CATEGORY_LIMITS_MB = {
  image: env.uploads.limits.image,
  document: env.uploads.limits.document,
  archive: env.uploads.limits.archive,
  video: env.uploads.limits.video,
  audio: env.uploads.limits.audio,
  other: env.uploads.limits.other,
};

/** @returns {number} the per-category cap in bytes, never above HARD_MAX_BYTES. */
export function limitBytesForCategory(category) {
  const mb = CATEGORY_LIMITS_MB[category] ?? env.uploads.defaultMaxFileSizeMb;
  return Math.min(Math.round(mb * MB), HARD_MAX_BYTES);
}

/** @returns {number} the per-category cap in MB (for display in an error). */
export function limitMbForCategory(category) {
  return Math.round(limitBytesForCategory(category) / MB);
}

/**
 * The pre-flight gate. Called with the client-declared size when there is one,
 * which is a hint only (see security/sizeLimits.js for the authoritative
 * streaming count) — but rejecting an obvious 40 GB video before accepting the
 * bytes is worth it.
 *
 * @throws {ApiError} 413 when over the cap.
 */
export function assertWithinLimit(category, sizeBytes) {
  const limit = limitBytesForCategory(category);
  if (Number(sizeBytes) > limit) {
    throw new ApiError(
      413,
      `File is too large: ${prettyMb(sizeBytes)} exceeds the ${prettyMb(limit)} limit for ${category} files`,
      { category, limitBytes: limit, sizeBytes: Number(sizeBytes) || 0 },
      'FILE_TOO_LARGE'
    );
  }
  return limit;
}

export function prettyMb(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * MB) return `${(n / (1024 * MB)).toFixed(2)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export default { limitBytesForCategory, limitMbForCategory, assertWithinLimit, prettyMb, HARD_MAX_BYTES };
