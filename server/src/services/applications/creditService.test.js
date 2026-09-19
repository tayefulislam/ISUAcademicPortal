import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { periodFor } from './creditService.js';

// The monthly period is what the recharge's compare-and-set guards on, so its
// boundaries must be unambiguous: the same instant always maps to the same
// period no matter how many times it is computed.

describe('periodFor', () => {
  test('a reset day of 1 is the calendar month', () => {
    const { start, end } = periodFor(new Date('2026-09-19T10:00:00Z'), 1);
    assert.equal(start.toISOString(), '2026-09-01T00:00:00.000Z');
    assert.equal(end.toISOString(), '2026-10-01T00:00:00.000Z');
  });

  test('before the reset day, the period is the one that started last month', () => {
    const { start, end } = periodFor(new Date('2026-09-05T10:00:00Z'), 15);
    assert.equal(start.toISOString(), '2026-08-15T00:00:00.000Z');
    assert.equal(end.toISOString(), '2026-09-15T00:00:00.000Z');
  });

  test('on the reset day, the new period has already begun', () => {
    const { start, end } = periodFor(new Date('2026-09-15T00:00:01Z'), 15);
    assert.equal(start.toISOString(), '2026-09-15T00:00:00.000Z');
    assert.equal(end.toISOString(), '2026-10-15T00:00:00.000Z');
  });

  test('a reset day beyond 28 is clamped to 28 so every month has it', () => {
    const { start, end } = periodFor(new Date('2026-02-15T00:00:00Z'), 31);
    assert.equal(start.toISOString(), '2026-01-28T00:00:00.000Z');
    assert.equal(end.toISOString(), '2026-02-28T00:00:00.000Z');
  });

  test('the same instant always yields the same period', () => {
    const at = new Date('2026-12-31T23:59:59Z');
    assert.deepEqual(periodFor(at, 1), periodFor(at, 1));
  });
});
