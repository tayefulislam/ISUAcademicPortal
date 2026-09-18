// A tiny retry helper for the delivery channels.
//
// Push is a bonus channel (the in-app Notification row is the system of record),
// so a transient failure is not worth surfacing to the caller — but dropping it
// on the first try is worse: FCM and the Web Push services both return genuinely
// transient errors (network hiccups, 5xx, quota) that succeed on a second
// attempt. Retrying a few times, with exponential backoff, is the difference
// between "the reminder arrived" and "the reminder silently vanished".
//
// Permanent failures (an unregistered device, a gone subscription) are NOT
// retried — `isRetryable` is how each caller says so, and retrying a token the
// service has already declared dead just burns the next attempt.

/** Sleeps for `ms`. Extracted so tests can drive retries without real delays. */
export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn` until it succeeds or the attempts run out.
 *
 * @param {(attempt:number) => Promise<any>} fn
 * @param {{attempts?:number, baseDelayMs?:number, isRetryable?:(err:any)=>boolean, onRetry?:(err:any, attempt:number)=>void, sleep?:(ms:number)=>Promise<void>}} [opts]
 * @returns {Promise<any>} the first successful result
 * @throws the last error once every attempt has failed
 */
export async function withRetry(fn, {
  attempts = 3,
  baseDelayMs = 250,
  isRetryable = () => true,
  onRetry = null,
  sleep = delay,
} = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      const exhausted = attempt >= attempts;
      if (exhausted || !isRetryable(err)) throw err;
      if (onRetry) onRetry(err, attempt);
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}

export default { withRetry, delay };
