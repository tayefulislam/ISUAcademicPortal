import webpush from 'web-push';
import { env } from '../../config/env.js';
import PushSubscription from '../../models/PushSubscription.js';

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
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body);
        sub.lastUsedAt = new Date();
        await sub.save();
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          sub.isActive = false;
          await sub.save();
        } else {
          console.error('[push] send failed', sub.endpoint, err.statusCode || err.message);
        }
      }
    })
  );
}
