import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCorsOrigin } from './corsOrigin.js';

/**
 * The CORS origin rule.
 *
 * <p>Pinned because getting it wrong is invisible from the outside: a refused
 * origin produces no Access-Control-Allow-Origin header, so the browser reports
 * only "blocked by CORS policy" and the real reason never reaches the client —
 * it reaches the server logs, if anything. That is exactly how a production
 * upload failed while working locally.
 *
 * <p>A silent logger is injected so these run without the Log collection.
 */

const silent = { warn: () => {}, error: () => {}, info: () => {} };

/** Runs the rule and reports what happened, in a shape tests can assert on. */
function check(origin, allowed) {
  const result = { allowed: false, error: null };
  const decide = makeCorsOrigin({ allowed, log: silent });

  decide(origin, (err, ok) => {
    if (err) {
      result.error = err;
      result.allowed = false;
    } else {
      result.allowed = ok !== false;
    }
  });

  return result;
}

const ALLOWED = ['https://isu-academic-portal.vercel.app', 'https://isuapp.tayeful.com'];

test('a request with no Origin is allowed — curl, the Android app, server-to-server', () => {
  // CORS is a browser mechanism; a native client has no origin to spoof, so
  // refusing these would break the Android app for no security gain.
  for (const origin of [undefined, null, '']) {
    assert.equal(check(origin, ALLOWED).allowed, true, `origin ${String(origin)}`);
  }
});

test('the configured origins are allowed, with or without a trailing slash', () => {
  assert.equal(check('https://isu-academic-portal.vercel.app', ALLOWED).allowed, true);
  assert.equal(check('https://isu-academic-portal.vercel.app/', ALLOWED).allowed, true);
  assert.equal(check('https://isuapp.tayeful.com', ALLOWED).allowed, true);
});

test('an unconfigured origin is refused with a 403, not a 500', () => {
  const result = check('https://someone-elses-site.example', ALLOWED);
  assert.equal(result.allowed, false);
  assert.ok(result.error, 'the callback receives an error');
  // 403 because refusing a caller is a policy decision, not a server fault —
  // a 500 here would page an operator for someone else's misconfiguration.
  assert.equal(result.error.statusCode, 403);
  assert.equal(result.error.code, 'CORS_ORIGIN_DENIED');
});

test('localhost is allowed on any port, over http or https', () => {
  for (const origin of [
    'http://localhost:5160',
    'http://localhost:3000',
    'https://localhost:7050',
    'http://127.0.0.1:5173',
    'https://127.0.0.1:8080',
  ]) {
    assert.equal(check(origin, ALLOWED).allowed, true, origin);
  }
});

test('a lookalike host cannot slip through as a substring match', () => {
  // The realistic attack: a domain that CONTAINS an allowed one.
  for (const origin of [
    'https://isu-academic-portal.vercel.app.evil.test',
    'https://evil.test/isu-academic-portal.vercel.app',
    'https://not-isuapp.tayeful.com',
    'https://isuapp.tayeful.com.evil.test',
  ]) {
    assert.equal(check(origin, ALLOWED).allowed, false, `${origin} must be refused`);
  }
});

test('the scheme and the port are part of the origin', () => {
  assert.equal(check('http://isuapp.tayeful.com', ALLOWED).allowed, false, 'http is not https');
  assert.equal(check('https://isuapp.tayeful.com:8443', ALLOWED).allowed, false, 'a different port is a different origin');
});

test('a wildcard entry is treated literally, not as a wildcard', () => {
  // Someone will eventually try `https://*.vercel.app` expecting it to match.
  // It must not: every preview deployment would then carry the API's trust.
  const withWildcard = ['https://*.vercel.app'];
  assert.equal(check('https://my-preview-abc123.vercel.app', withWildcard).allowed, false);
  assert.equal(check('https://*.vercel.app', withWildcard).allowed, true, 'matched only as a literal');
});

test('an empty allow-list refuses every real origin but still permits localhost', () => {
  assert.equal(check('https://isuapp.tayeful.com', []).allowed, false);
  assert.equal(check('http://localhost:5160', []).allowed, true);
  assert.equal(check(undefined, []).allowed, true);
});
