import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAsDhakaTime, formatInAppTimezone, APP_TIMEZONE } from './timezone.js';

// Bangladesh Standard Time fix — see the "Fix Quiz Time System" spec: quiz
// start/end times entered by faculty (a bare `datetime-local` string, no
// offset) must be interpreted as Asia/Dhaka (UTC+06:00), not the server
// process's own timezone, and a value that already carries an explicit
// offset/`Z` (e.g. an existing UTC ISO string echoed back unmodified on
// update) must never be shifted a second time.
describe('parseAsDhakaTime', () => {
  test('interprets a bare datetime-local string as Bangladesh local time', () => {
    // Spec example: 2026-09-11 10:00 Asia/Dhaka -> 2026-09-11T04:00:00.000Z
    const d = parseAsDhakaTime('2026-09-11T10:00');
    assert.equal(d.toISOString(), '2026-09-11T04:00:00.000Z');
  });

  test('interprets a bare datetime-local string with seconds the same way', () => {
    const d = parseAsDhakaTime('2026-09-11T10:00:30');
    assert.equal(d.toISOString(), '2026-09-11T04:00:30.000Z');
  });

  test('second spec example: 12:00 PM Bangladesh -> 06:00:00Z', () => {
    const d = parseAsDhakaTime('2026-09-11T12:00');
    assert.equal(d.toISOString(), '2026-09-11T06:00:00.000Z');
  });

  test('trusts a value that already carries a Z suffix instead of re-shifting it', () => {
    const d = parseAsDhakaTime('2026-09-11T04:00:00.000Z');
    assert.equal(d.toISOString(), '2026-09-11T04:00:00.000Z');
  });

  test('trusts a value that already carries an explicit +06:00 offset', () => {
    const d = parseAsDhakaTime('2026-09-11T10:00:00+06:00');
    assert.equal(d.toISOString(), '2026-09-11T04:00:00.000Z');
  });

  test('trusts a value with a different explicit offset (not Dhaka) rather than assuming Dhaka', () => {
    const d = parseAsDhakaTime('2026-09-11T10:00:00+00:00');
    assert.equal(d.toISOString(), '2026-09-11T10:00:00.000Z');
  });

  test('same-day quiz window: a 1-hour same-day window stays on the same date', () => {
    const start = parseAsDhakaTime('2026-09-11T10:00');
    const end = parseAsDhakaTime('2026-09-11T11:00');
    assert.equal(start.toISOString(), '2026-09-11T04:00:00.000Z');
    assert.equal(end.toISOString(), '2026-09-11T05:00:00.000Z');
    assert.ok(end > start);
  });

  test('midnight/cross-day quiz: 11 PM -> 1 AM next day is a valid two-hour window', () => {
    const start = parseAsDhakaTime('2026-09-11T23:00');
    const end = parseAsDhakaTime('2026-09-12T01:00');
    assert.equal(start.toISOString(), '2026-09-11T17:00:00.000Z');
    assert.equal(end.toISOString(), '2026-09-11T19:00:00.000Z');
    assert.equal(end.getTime() - start.getTime(), 2 * 60 * 60 * 1000);
    assert.ok(end > start);
  });

  test('returns null for empty/missing input', () => {
    assert.equal(parseAsDhakaTime(''), null);
    assert.equal(parseAsDhakaTime(null), null);
    assert.equal(parseAsDhakaTime(undefined), null);
  });

  test('returns null for an unparseable string', () => {
    assert.equal(parseAsDhakaTime('not-a-date'), null);
  });

  test('accepts a Date instance directly, unmodified', () => {
    const original = new Date('2026-09-11T04:00:00.000Z');
    const d = parseAsDhakaTime(original);
    assert.equal(d.toISOString(), original.toISOString());
  });
});

describe('formatInAppTimezone', () => {
  test('renders a UTC instant back as its Bangladesh wall-clock equivalent', () => {
    const rendered = formatInAppTimezone('2026-09-11T04:00:00.000Z');
    assert.match(rendered, /10:00 AM/);
    assert.match(rendered, /Sep 11, 2026/);
  });

  test('returns empty string for missing input', () => {
    assert.equal(formatInAppTimezone(null), '');
    assert.equal(formatInAppTimezone(''), '');
  });
});

test('APP_TIMEZONE is the single centralized constant', () => {
  assert.equal(APP_TIMEZONE, 'Asia/Dhaka');
});
