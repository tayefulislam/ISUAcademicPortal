/**
 * Validation for "external material link" submissions (Google Drive, OneDrive,
 * Dropbox, or any other document/file URL) — a File entry that points at a
 * third-party HTTPS URL instead of an uploaded object.
 *
 * Deliberately strict: only `https://` is accepted. `http://` and every other
 * scheme (`javascript:`, `data:`, `file:`, …) are rejected so a stored link can
 * never become an injection vector when a client renders it in a browser or a
 * WebView. Nothing here trusts the client's own check — this is the server-side
 * gate (see fileController.resolveExternalSubmission).
 */

const MAX_EXTERNAL_URL_LENGTH = 2048;

/**
 * True only for a syntactically valid absolute `https://` URL with a host.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidHttpsUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_EXTERNAL_URL_LENGTH) return false;

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  return parsed.protocol === 'https:' && Boolean(parsed.hostname);
}

/**
 * Throws an ApiError-compatible Error (message only) when the URL is not a
 * valid HTTPS link. Kept dependency-free so callers can throw their own
 * ApiError with the returned message.
 * @param {unknown} value
 * @returns {string} the trimmed, validated URL
 */
export function requireValidHttpsUrl(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!isValidHttpsUrl(trimmed)) {
    const err = new Error('The external link must be a valid https:// URL');
    err.statusCode = 400;
    throw err;
  }
  return trimmed;
}
