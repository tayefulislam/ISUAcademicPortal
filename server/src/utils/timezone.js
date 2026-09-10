// Centralized timezone policy for the entire app: every user-facing quiz/exam
// schedule (quiz startAt/endAt, scheduled-result release, etc.) is entered
// and displayed in Bangladesh Standard Time, regardless of the server's own
// OS timezone or the browser's timezone. Bangladesh has no daylight-saving
// time, so the offset is a fixed constant — no IANA tz database / date
// library is needed to get this right.
export const APP_TIMEZONE = 'Asia/Dhaka';
export const APP_TIMEZONE_OFFSET = '+06:00';
export const APP_TIMEZONE_OFFSET_MINUTES = 6 * 60;

const HAS_EXPLICIT_OFFSET = /(?:[zZ]|[+-]\d{2}:?\d{2})$/;

// Turns whatever the client sent for a quiz-schedule field into the correct
// UTC instant. Two shapes are accepted:
//  - Already carries an explicit offset/`Z` (e.g. a UTC ISO string echoed
//    back unmodified on update, or a client that already appended
//    +06:00 itself) — trusted as-is, never re-interpreted, so a value that's
//    already a correct UTC instant is never accidentally shifted again.
//  - A bare/naive string with no offset (e.g. a `datetime-local` input's
//    "YYYY-MM-DDTHH:mm[:ss]") — treated as Bangladesh local time, per this
//    app's single-institution scheduling policy (section 1 of the spec).
// Returns `null` for empty/invalid input so callers can raise their own
// "required"/"invalid" error with the right message.
export function parseAsDhakaTime(input) {
  if (!input) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;

  const raw = String(input).trim();
  if (!raw) return null;

  if (HAS_EXPLICIT_OFFSET.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Normalize "YYYY-MM-DDTHH:mm" -> "YYYY-MM-DDTHH:mm:00" so appending the
  // offset below always produces a syntactically valid ISO string.
  const withSeconds = /T\d{2}:\d{2}$/.test(raw) ? `${raw}:00` : raw;
  const d = new Date(`${withSeconds}${APP_TIMEZONE_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatInAppTimezone(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const datePart = d.toLocaleDateString('en-US', { timeZone: APP_TIMEZONE, year: 'numeric', month: 'short', day: 'numeric' });
  const timePart = d.toLocaleTimeString('en-US', { timeZone: APP_TIMEZONE, hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${timePart} BST`;
}

// The one place "now" is obtained for quiz-timing comparisons — a UTC
// instant is timezone-agnostic by construction (epoch ms), so this is
// already correct no matter what timezone the server process itself runs
// in; centralized purely so every comparison in the codebase goes through
// the same function instead of scattered `new Date()`/`Date.now()` calls.
export function getCurrentInstant() {
  return new Date();
}
