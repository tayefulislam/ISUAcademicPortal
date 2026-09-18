import webpush from 'web-push';
import { env } from '../../config/env.js';
import PushSubscription from '../../models/PushSubscription.js';
import { withRetry } from '../../utils/retry.js';

/** A subscription the push service says will never work again. */
function isGone(error) {
  return error?.statusCode === 404 || error?.statusCode === 410;
}

const PUSH_ATTEMPTS = 3;

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  if (!env.vapid.publicKey || !env.vapid.privateKey) return false;
  webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey);
  configured = true;
  return true;
}

export function getVapidPublicKey() {
  return env.vapid.publicKey;
}

/**
 * Pushes `payload` (plain object — the SW JSON.parses it) to every active
 * device belonging to `userId`. Never throws — a push failure must never
 * break the caller's flow (spec §25: push is a bonus channel, in-app
 * notifications are the system of record). Deactivates a subscription the
 * push service says is gone (410 Gone / 404 Not Found).
 */
export async function sendToUser(userId, payload) {
  if (!ensureConfigured()) return; // no VAPID keys configured — silently skip, in-app still works

  const subscriptions = await PushSubscription.find({ user: userId, isActive: true });
  if (!subscriptions.length) return;

  const body = JSON.stringify(payload);
  await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        // A transient failure (network, 5xx, 429) is retried; a gone
        // subscription is not — retrying it only burns the attempts.
        await withRetry(
          () => webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body),
          { attempts: PUSH_ATTEMPTS, baseDelayMs: 250, isRetryable: (err) => !isGone(err) }
        );
        sub.lastUsedAt = new Date();
        await sub.save();
      } catch (err) {
        if (isGone(err)) {
          sub.isActive = false;
          await sub.save();
        } else {
          console.error('[push] send failed after retries', sub.endpoint, err.statusCode || err.message);
        }
      }
    })
  );
}
