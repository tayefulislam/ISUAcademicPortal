import { env } from '../../../config/env.js';

/**
 * The keep-original rule (§11, §22).
 *
 * "Never assume compression will always be smaller" is the single most important
 * economic rule in the spec, and it is enforced here, in one function that every
 * processor must pass through:
 *
 *     saving = originalSize - candidateSize
 *
 * A candidate replaces the original only when it is strictly smaller AND clears
 * BOTH a byte floor and a percentage floor. The byte floor stops a pathological
 * case (a 4 KB scan "saving" 200 bytes); the percentage floor is the spec's
 * explicit example — a 98 MB PDF becoming 94 MB is a 4% win that is not worth
 * swapping a file for, so the original stays.
 */

/** Plain arithmetic, without the decision. */
export function computeSavings(originalSize, candidateSize) {
  const original = Number(originalSize) || 0;
  const candidate = Number(candidateSize) || 0;
  const savedBytes = Math.max(original - candidate, 0);
  const savedPercentage = original > 0 ? Number(((savedBytes / original) * 100).toFixed(2)) : 0;
  return { savedBytes, savedPercentage };
}

/**
 * @param {number} originalSize
 * @param {number} candidateSize the size of the processed version
 * @param {{minBytes?:number, minPercent?:number}} [opts] override the configured floors
 * @returns {{keep:boolean, reason:string, savedBytes:number, savedPercentage:number}}
 */
export function isWorthKeeping(originalSize, candidateSize, opts = {}) {
  const minBytes = opts.minBytes ?? env.uploads.optimization.minSavingBytes;
  const minPercent = opts.minPercent ?? env.uploads.optimization.minSavingPercent;

  const original = Number(originalSize) || 0;
  const candidate = Number(candidateSize) || 0;

  // Not smaller at all — never trade quality for a bigger file.
  if (candidate >= original) {
    return { keep: false, reason: 'not-smaller', ...computeSavings(original, candidate) };
  }

  const savings = computeSavings(original, candidate);

  if (savings.savedBytes < minBytes) {
    return { keep: false, reason: 'below-byte-floor', ...savings, minBytes };
  }
  if (savings.savedPercentage < minPercent) {
    return { keep: false, reason: 'below-percent-floor', ...savings, minPercent };
  }

  return { keep: true, reason: 'worth-it', ...savings };
}

export default { computeSavings, isWorthKeeping };
