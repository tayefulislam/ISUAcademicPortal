// Date arithmetic for the class routine, all in the institution's calendar
// (Asia/Dhaka). Class times are entered and displayed as Dhaka wall-clock, so a
// "Sunday 10:00" slot means Sunday 10:00 in Dhaka regardless of where the server
// or the viewer happens to be. Reuses the same offset constant as
// utils/timezone.js rather than restating +06:00.

import { APP_TIMEZONE_OFFSET_MINUTES, parseAsDhakaTime, formatInAppTimezone, APP_TIMEZONE } from './timezone.js';

export { parseAsDhakaTime, formatInAppTimezone, APP_TIMEZONE };

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_ONLY = /^\d{1,2}:\d{2}$/;

/** True for a plain "YYYY-MM-DD" calendar date. */
export function isDateOnly(value) {
  return typeof value === 'string' && DATE_ONLY.test(value.trim());
}

/** True for a plain "HH:mm" wall-clock time. */
export function isTimeOnly(value) {
  if (typeof value !== 'string' || !TIME_ONLY.test(value.trim())) return false;
  const [h, m] = value.trim().split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** Normalizes "9:5" -> "09:05" so stored times sort and compare as strings. */
export function normalizeTime(value) {
  const [h, m] = String(value).trim().split(':').map(Number);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * The Dhaka calendar date ("YYYY-MM-DD") for an instant. Bangladesh has no DST,
 * so shifting by the fixed offset and reading the UTC date is exact — and it
 * avoids `toLocaleDateString`, which depends on the ICU data of the runtime.
 */
export function dhakaDateString(date = new Date()) {
  const shifted = new Date(date.getTime() + APP_TIMEZONE_OFFSET_MINUTES * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Weekday (0 = Sunday) of a calendar date. Computed from the date's own digits
 * via Date.UTC, never from a Dhaka-parsed instant: midnight Dhaka is 18:00 UTC
 * the previous day, so reading `.getUTCDay()` off a parsed instant would report
 * the wrong weekday for every slot before 06:00.
 */
export function weekdayOf(dateStr) {
  const [y, m, d] = String(dateStr).trim().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** A UTC instant for a Dhaka wall-clock date + time (e.g. "2026-09-20", "10:00"). */
export function combineDhakaDateTime(dateStr, timeStr) {
  return parseAsDhakaTime(`${String(dateStr).trim()}T${normalizeTime(timeStr)}`);
}

/** Every calendar date from `startDate` to `endDate`, inclusive. */
export function eachDateInclusive(startDate, endDate) {
  const dates = [];
  const [sy, sm, sd] = String(startDate).trim().split('-').map(Number);
  const [ey, em, ed] = String(endDate).trim().split('-').map(Number);
  let cursor = Date.UTC(sy, sm - 1, sd);
  const end = Date.UTC(ey, em - 1, ed);
  if (Number.isNaN(cursor) || Number.isNaN(end) || cursor > end) return dates;

  // Guard against an unbounded range: a few years of slots is far more than any
  // real timetable, and a typo'd end date should not materialise thousands of
  // documents. Kept high enough that extending a rule to the end of an academic
  // programme still materialises the whole tail.
  const MAX_DAYS = 1100;
  for (let i = 0; i <= MAX_DAYS && cursor <= end; i += 1) {
    dates.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += MS_PER_DAY;
  }
  return dates;
}

export function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + minutes * 60 * 1000);
}

export function minutesBetween(from, to) {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000);
}

/** Start of the Dhaka day (as a UTC instant) containing `date`. */
export function startOfDhakaDay(date = new Date()) {
  return combineDhakaDateTime(dhakaDateString(date), '00:00');
}

/** Exclusive end of the Dhaka day containing `date`. */
export function endOfDhakaDay(date = new Date()) {
  return new Date(startOfDhakaDay(date).getTime() + MS_PER_DAY);
}

/** "10:00" for an instant, in Dhaka. */
export function dhakaClock(date) {
  const shifted = new Date(new Date(date).getTime() + APP_TIMEZONE_OFFSET_MINUTES * 60 * 1000);
  return shifted.toISOString().slice(11, 16);
}
