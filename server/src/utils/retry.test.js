import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from './retry.js';

// A no-op sleeper, so the retry tests exercise the control flow without waiting.
const noSleep = async () => {};

describe('withRetry', () => {
  test('returns the first successful result without retrying', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      return 'ok';
    }, { sleep: noSleep });

    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  test('retries a transient failure and succeeds on a later attempt', async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      if (calls < 3) throw new Error('transient');
      return 'recovered';
    }, { attempts: 3, sleep: noSleep });

    assert.equal(result, 'recovered');
    assert.equal(calls, 3);
  });

  test('gives up after the attempts and throws the last error', async () => {
    let calls = 0;
    await assert.rejects(
      () => withRetry(async () => {
        calls += 1;
        throw new Error(`fail ${calls}`);
      }, { attempts: 3, sleep: noSleep }),
      /fail 3/
    );
    assert.equal(calls, 3, 'exactly `attempts` tries, never more');
  });

  test('does not retry what the caller calls permanent', async () => {
    let calls = 0;
    await assert.rejects(
      () => withRetry(async () => {
        calls += 1;
        throw new Error('gone');
      }, { attempts: 5, isRetryable: () => false, sleep: noSleep }),
      /gone/
    );
    assert.equal(calls, 1, 'a gone subscription must not burn every attempt');
  });

  test('backs off exponentially between attempts', async () => {
    const delays = [];
    await assert.rejects(() => withRetry(async () => {
      throw new Error('x');
    }, {
      attempts: 3,
      baseDelayMs: 100,
      sleep: async (ms) => { delays.push(ms); },
    }));

    assert.deepEqual(delays, [100, 200]);
  });
});
