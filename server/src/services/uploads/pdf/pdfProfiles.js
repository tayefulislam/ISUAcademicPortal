import { env } from '../../../config/env.js';
import { ApiError } from '../../../utils/ApiError.js';

/**
 * The three PDF quality profiles from the spec (§6).
 *
 * HIGH_QUALITY   — important academic documents; minimal visual degradation.
 * BALANCED       — the default; good readability *and* good savings.
 * SMALL_SIZE     — for a user who explicitly wants a smaller file, while still
 *                  preserving readable text.
 *
 * Each profile is just a pixel ceiling plus a JPEG quality. Everything else
 * about optimization is shared, so a profile can never change *how* a PDF is
 * rebuilt — only how hard it squeezes — which keeps the safety properties in one
 * place.
 */

export const PDF_PROFILES = ['HIGH_QUALITY', 'BALANCED', 'SMALL_SIZE'];

export const DEFAULT_PDF_PROFILE = PDF_PROFILES.includes(env.uploads.optimization.defaultPdfProfile)
  ? env.uploads.optimization.defaultPdfProfile
  : 'BALANCED';

/**
 * Normalizes a profile name, falling back to the configured default rather than
 * throwing — an unknown profile from a client should not fail an upload.
 */
export function resolveProfile(name) {
  const key = String(name || '').toUpperCase().trim();
  const selected = PDF_PROFILES.includes(key) ? key : DEFAULT_PDF_PROFILE;
  const cfg = env.uploads.pdf.profiles[selected];
  return {
    name: selected,
    // Long-edge pixel ceiling. An embedded image at or below this is left at its
    // own resolution.
    maxLongEdge: cfg.maxLongEdge,
    jpegQuality: cfg.jpegQuality,
    downscaleOnly: cfg.downscaleOnly !== false,
  };
}

/** Validates a client-supplied profile name, for the request validators. */
export function assertValidProfile(name) {
  const key = String(name || '').toUpperCase().trim();
  if (key && !PDF_PROFILES.includes(key)) {
    throw new ApiError(400, `Unknown PDF quality profile: ${name}`, { allowed: PDF_PROFILES }, 'INVALID_PROFILE');
  }
  return key || DEFAULT_PDF_PROFILE;
}

export default { PDF_PROFILES, DEFAULT_PDF_PROFILE, resolveProfile, assertValidProfile };
