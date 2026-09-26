import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Filename and storage-key safety (§17).
 *
 * Two rules, stated once so they can be enforced everywhere:
 *
 *   1. The user's filename is DISPLAY DATA. It is sanitized for storage in the
 *      database and echoed back, and is never used to build a filesystem path or
 *      an object key. That alone removes path traversal as a category — there is
 *      no path to traverse — but it is still sanitized, because it is rendered
 *      in the UI and reflected into a Content-Disposition header.
 *
 *   2. Storage keys are GENERATED, never derived from user input beyond a
 *      validated, allow-listed extension.
 */

// Windows-reserved device names. A file called `CON.pdf` is unopenable on
// Windows and can confuse tooling; the prefix is neutralized.
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// Every character that is unsafe in a filename, an HTTP header value, or a
// shell argument. Newlines matter specifically: they would break out of a
// Content-Disposition header.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;

/**
 * Produces a safe, human-readable version of an uploaded filename.
 *
 * Strips any directory component (so `../../etc/passwd` becomes `passwd`), all
 * control and reserved characters, leading dots (no hidden files, no `..`), and
 * bounds the length well under every filesystem's limit while keeping the
 * extension intact.
 *
 * @param {string} name
 * @returns {string} never empty, never contains a path separator
 */
export function sanitizeFilename(name) {
  // Take the basename first, and treat both separators as separators regardless
  // of the host platform — a POSIX-style path arriving on Windows must not be
  // treated as one opaque filename.
  const base = String(name ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .pop() || '';

  let safe = base
    .replace(UNSAFE_CHARS, '_')
    .replace(/\.\.+/g, '.') // collapse any traversal remnant
    .replace(/^\.+/, '') // no leading dots
    .replace(/\s+/g, ' ')
    .trim();

  if (RESERVED_NAMES.test(safe)) safe = `_${safe}`;
  if (!safe) safe = 'file';

  // Bound the length, preserving the extension.
  const MAX = 180;
  if (safe.length > MAX) {
    const ext = path.extname(safe);
    const stem = safe.slice(0, Math.max(1, MAX - ext.length));
    safe = `${stem}${ext}`;
  }

  return safe;
}

/**
 * The extension, lower-cased and restricted to `[a-z0-9]`. Anything else
 * (including an empty result, or an over-long one) degrades to `bin` — which
 * classifies as "other" and is therefore never auto-optimized.
 */
export function safeExtension(extension) {
  const cleaned = String(extension || '')
    .replace(/^\./, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  if (!cleaned || cleaned.length > 12) return 'bin';
  return cleaned;
}

/** A slug safe to use as a single key segment. */
export function safeSegment(segment, fallback = 'general') {
  const cleaned = String(segment || '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return cleaned || fallback;
}

/**
 * Builds the object key for a stored file.
 *
 * The key is entirely generated — a UUID supplies the uniqueness, so no part of
 * the user's input can influence WHERE the object lands. The date and owner
 * segments keep the bucket navigable and make a lifecycle rule or a per-user
 * audit straightforward.
 *
 * Example: `academic-material/2026/09/64abc.../0f2e...-a1b.pdf`
 */
export function buildStorageKey({ purpose = 'general', ownerId = '', extension = 'bin', now = new Date() } = {}) {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const owner = String(ownerId || 'anonymous').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) || 'anonymous';
  const unique = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
  return `${safeSegment(purpose)}/${year}/${month}/${owner}/${unique}.${safeExtension(extension)}`;
}

/**
 * A filename safe to place in a `Content-Disposition` header.
 *
 * RFC 6266's `filename*` form carries the real (UTF-8) name; the plain
 * `filename` is an ASCII fallback for ancient clients. Both are stripped of
 * quotes, backslashes and newlines — a raw newline in a header value is a
 * response-splitting attempt.
 */
export function contentDisposition(disposition, filename) {
  const ascii = String(filename || 'download')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(String(filename || 'download'));
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export default { sanitizeFilename, safeExtension, safeSegment, buildStorageKey, contentDisposition };
