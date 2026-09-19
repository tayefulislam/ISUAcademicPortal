import { ApiError } from './ApiError.js';

// A faculty member's academic rank ("Lecturer", "Assistant Professor", …).
//
// It is the ONE piece of a faculty record whose vocabulary is admin-managed
// (Settings.facultyDesignations) rather than free text, because it prints on a
// cover page: a typo would be visible on every document that teacher signs.

/** Trims and collapses runs of whitespace, keeping the spelling as entered. */
export function cleanDesignation(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

/**
 * Resolves a submitted designation against the configured list.
 *
 * <p>Returns the CONFIGURED spelling rather than the submitted one, so a client
 * sending "assistant professor" stores and prints "Assistant Professor". An
 * empty value clears the designation; anything not on the list is refused.
 *
 * @param {string} value the submitted designation (may be empty)
 * @param {object} settings the Settings document
 * @returns {string} the designation to store, or '' to clear it
 */
export function assertDesignation(value, settings) {
  const clean = cleanDesignation(value);
  if (!clean) return '';

  const options = Array.isArray(settings?.facultyDesignations) ? settings.facultyDesignations : [];
  const match = options.find((option) => String(option).trim().toLowerCase() === clean.toLowerCase());
  if (!match) {
    throw new ApiError(422, 'Choose a designation from the configured list (System Management → Faculty Designations).');
  }
  return String(match).trim();
}

export default { cleanDesignation, assertDesignation };
