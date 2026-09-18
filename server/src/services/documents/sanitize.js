// Text sanitization for the Document Generator. Kept pure and dependency-free
// so it can be unit-tested directly, and used by both the renderer (escaping
// every interpolated value) and the input path (coercing a submitted value).

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

/**
 * Escapes every character that could break out of a text node or an attribute.
 *
 * <p>This is the single defence against a student turning a cover-page field
 * into markup: field values are always escaped here before they reach the
 * template string, so a value like `<img onerror=...>` prints as text. Template
 * HTML/CSS is admin-authored and never passes through this path.
 */
export function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"'`]/g, (char) => HTML_ESCAPES[char]);
}

/**
 * Trims a user-supplied string and drops control characters that have no place
 * in a document (NUL, bell, vertical tab, …) while keeping ordinary whitespace.
 * Optionally caps the length.
 */
export function cleanText(value, maxLength = 0) {
  let text = String(value == null ? '' : value)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  if (maxLength > 0 && text.length > maxLength) {
    text = text.slice(0, maxLength);
  }
  return text;
}

/** Escapes a value for use inside a CSS string (colour, font-family). */
export function escapeCssValue(value, fallback = '') {
  const text = String(value == null ? '' : value).trim();
  if (!text) return fallback;
  // Allow only characters that legitimately appear in a colour or a font stack,
  // so a template cannot smuggle a `;`/`}` and break out of the declaration.
  return /^[a-zA-Z0-9#(),.\s'"\-_%]+$/.test(text) ? text : fallback;
}
