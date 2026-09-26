import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSavings, isWorthKeeping } from './compareSizes.js';

test('computeSavings does the plain arithmetic', () => {
  assert.deepEqual(computeSavings(1000, 500), { savedBytes: 500, savedPercentage: 50 });
  // A candidate bigger than the original never reports a negative saving.
  assert.deepEqual(computeSavings(1000, 1500), { savedBytes: 0, savedPercentage: 0 });
  assert.deepEqual(computeSavings(0, 0), { savedBytes: 0, savedPercentage: 0 });
});

test('rejects a candidate that is not smaller (the §22 rule)', () => {
  const result = isWorthKeeping(1024, 1024);
  assert.equal(result.keep, false);
  assert.equal(result.reason, 'not-smaller');

  const bigger = isWorthKeeping(1024, 2048);
  assert.equal(bigger.keep, false);
  assert.equal(bigger.reason, 'not-smaller');
});

test('keeps a genuinely worthwhile saving', () => {
  const result = isWorthKeeping(100 * 1024 * 1024, 30 * 1024 * 1024, { minBytes: 0, minPercent: 0 });
  assert.equal(result.keep, true);
  assert.equal(result.reason, 'worth-it');
  assert.equal(result.savedPercentage, 70);
});

test('the spec example: 98 MB -> 94 MB is NOT worth swapping', () => {
  const original = 98 * 1024 * 1024;
  const optimized = 94 * 1024 * 1024;
  // 4% — under the 5% floor, even though the byte saving is large.
  const result = isWorthKeeping(original, optimized, { minBytes: 0, minPercent: 5 });
  assert.equal(result.keep, false);
  assert.equal(result.reason, 'below-percent-floor');
});

test('the byte floor stops a trivial absolute saving', () => {
  // 400 KB -> 300 KB is a 25% cut but only 100 KB of bytes.
  const result = isWorthKeeping(400 * 1024, 300 * 1024, { minBytes: 512 * 1024, minPercent: 0 });
  assert.equal(result.keep, false);
  assert.equal(result.reason, 'below-byte-floor');
});

test('a large saving clears both floors', () => {
  const result = isWorthKeeping(50 * 1024 * 1024, 10 * 1024 * 1024, { minBytes: 256 * 1024, minPercent: 5 });
  assert.equal(result.keep, true);
  assert.equal(result.savedBytes, 40 * 1024 * 1024);
  assert.equal(result.savedPercentage, 80);
});
