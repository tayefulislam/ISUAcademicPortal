import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Which browser origins may call this API.
 *
 * The browser's own report of a refusal is only ever "blocked by CORS policy" —
 * it cannot say WHICH origin was refused or what is allowed — so the decision is
 * made explicit and logged here rather than inlined at the mount point. It lives
 * in its own module so the rule can be tested without booting a server.
 *
 * The policy, in full:
 *
 *   - **No Origin header is allowed.** curl, a native app, and server-to-server
 *     calls send none. CORS is a browser mechanism; refusing these would break
 *     the Android app for no security gain (it has no origin to spoof).
 *   - **localhost / 127.0.0.1 on any port is allowed**, permanently. It is a dev
 *     convenience and harmless in production, because CORS is enforced by the
 *     browser against the page's real origin — a remote attacker gains nothing
 *     by making their page claim to be localhost.
 *   - **Everything else must match an entry in `CLIENT_URL`** (comma-separated),
 *     compared EXACTLY, after stripping one trailing slash from each side.
 *
 * What is deliberately NOT supported: wildcards. `https://*.vercel.app` in the
 * list is treated as a literal string and matches nothing, so preview
 * deployments need their own entry — which is the safe default. There is no
 * substring matching either, so a lookalike host such as
 * `https://app.example.com.evil.test` can never match `https://app.example.com`.
 *
 * @param {{allowed?: string[], log?: object}} [options] injectable for tests
 */
export function makeCorsOrigin({ allowed = env.clientUrls, log = logger } = {}) {
  return function corsOrigin(origin, callback) {
    if (!origin) {
      return callback(null, true);
    }

    const normalised = String(origin).replace(/\/$/, '');

    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalised)) {
      return callback(null, true);
    }
    if (allowed.includes(normalised)) {
      return callback(null, true);
    }

    log.warn(
      `[cors] refused a cross-origin request from ${normalised}. `
        + `Add it to CLIENT_URL (currently allowing: ${allowed.join(', ') || 'none'})`,
      { source: 'corsOrigin' }
    );

    // 403, not 500: this is a decision about the caller, not a fault in the
    // server. The reason goes to the LOGS and not the response — an origin we
    // have refused must not be able to read anything back, and without the
    // Access-Control-Allow-Origin header the browser will not show it to them
    // anyway.
    const error = new Error(`Origin not allowed: ${normalised}`);
    error.statusCode = 403;
    error.code = 'CORS_ORIGIN_DENIED';
    return callback(error);
  };
}

export default { makeCorsOrigin };
