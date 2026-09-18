import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { env } from '../../config/env.js';
import UserDevice from '../../models/UserDevice.js';
import { delay } from '../../utils/retry.js';

const FCM_ATTEMPTS = 3;
const FCM_BASE_DELAY_MS = 250;

// The channel the Android client creates at startup (NotificationChannels.java).
// Kept here as well because the system tray notification for a backgrounded app
// is rendered by Android, not by the app, from this exact id — a mismatch would
// silently downgrade it to the "Other" channel.
export const ANDROID_CHANNEL_ID = 'isu_academic_portal';

// FCM data values must ALL be strings, and null/undefined values are rejected
// outright — so a payload is filtered to strings rather than stringified
// wholesale (which would send the literal "null").
const DATA_KEYS = [
  'notificationId',
  'type',
  'entityType',
  'entityId',
  'url',
  'courseId',
  'fileId',
  'assignmentId',
  'quizId',
  'attemptId',
  'noticeId',
  'conversationId',
  // Class routine / academic calendar. The Android NotificationRouter reads
  // these to open the routine screen and to focus the right occurrence.
  'routineId',
  'eventId',
  'eventType',
];

let messaging = null;
let attempted = false;

/**
 * Initialises the Admin SDK once, lazily, and returns null when no service
 * account is configured. Returning null (rather than throwing) is what makes FCM
 * an optional channel: with no credentials the server behaves exactly as it did
 * before this feature existed, and every in-app notification still works.
 *
 * Mirrors pushService.js's `ensureConfigured()` for Web Push.
 */
function ensureMessaging() {
  if (attempted) return messaging;
  attempted = true;

  const { serviceAccountJson, serviceAccountPath } = env.firebase;
  if (!serviceAccountJson && !serviceAccountPath) {
    return null; // not configured — push is silently skipped
  }

  try {
    // A single app for the whole process; a second initializeApp() with the same
    // name throws, and hot-reloading dev servers hit that easily.
    const app = getApps().length
      ? getApps()[0]
      : initializeApp({
          credential: serviceAccountJson ? cert(JSON.parse(serviceAccountJson)) : cert(serviceAccountPath),
        });
    messaging = getMessaging(app);
    console.log('[fcm] Firebase Admin initialised');
  } catch (err) {
    // A malformed service account must not take the process down on boot —
    // push degrades to "off" and everything else keeps working.
    console.error('[fcm] initialisation failed — push disabled:', err.message);
    messaging = null;
  }

  return messaging;
}

/** True when FCM says this token will never work again, so the row can be retired. */
function isDeadToken(error) {
  const code = error?.code || '';
  return (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token' ||
    code === 'messaging/invalid-argument'
  );
}

/**
 * Sends `message` to `tokens`, retrying only what could plausibly succeed on a
 * second try: a thrown error means the whole call failed (network/quota), and a
 * per-token error that is not a dead token is transient. A dead token is
 * reported back so the caller retires it rather than retrying it.
 *
 * @returns {Promise<{sent:number, dead:string[], unretried:number}>}
 */
async function sendMulticastWithRetry(client, tokens, message) {
  let pending = [...tokens];
  const dead = [];
  let sent = 0;

  for (let attempt = 1; attempt <= FCM_ATTEMPTS && pending.length; attempt += 1) {
    if (attempt > 1) await delay(FCM_BASE_DELAY_MS * 2 ** (attempt - 2));

    let response;
    try {
      response = await client.sendEachForMulticast({ ...message, tokens: pending });
    } catch (err) {
      if (attempt >= FCM_ATTEMPTS) console.error('[fcm] multicast failed after retries:', err.message);
      continue;
    }

    const retry = [];
    response.responses.forEach((result, index) => {
      if (result.success) sent += 1;
      else if (isDeadToken(result.error)) dead.push(pending[index]);
      else retry.push(pending[index]);
    });
    pending = retry;
  }

  return { sent, dead, unretried: pending.length };
}

export function buildPushData({ notificationId, type, entityType, entityId, url, vars = {} }) {
  const raw = { notificationId, type, entityType, entityId, url, ...vars };
  const data = {};
  for (const key of DATA_KEYS) {
    const value = raw[key];
    // Empty strings are dropped too: `entityType` is '' on most events, and an
    // empty data value is dead weight in a payload the client then has to
    // null-check.
    const text = value === undefined || value === null || typeof value === 'object'
      ? ''
      : String(value);
    if (text) {
      data[key] = text;
    }
  }
  return data;
}

/**
 * Sends one push per active device belonging to `userId`, in a single multicast
 * call. Never throws — push is a bonus channel and must never break the caller's
 * flow (spec §25: the in-app Notification record is the system of record).
 *
 * `data` is what the Android client uses to route a tap to the right screen; it
 * is deliberately duplicated alongside `notification` so that a tap works both
 * when the app is foregrounded (onMessageReceived) and when it is background or
 * closed (the system delivers `data` as intent extras on the launch intent).
 */
export async function sendToUserDevices(userId, payload = {}) {
  const { title = '', body = '', data = {} } = payload || {};

  const client = ensureMessaging();
  if (!client) return { sent: 0, skipped: 'not-configured' };

  const devices = await UserDevice.find({ user: userId, isActive: true }).select('fcmToken');
  if (!devices.length) return { sent: 0, skipped: 'no-devices' };

  // Everything must be strings for FCM.
  const safeData = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (typeof value === 'string' && value) safeData[key] = value;
  }

  const message = {
    notification: { title: String(title ?? ''), body: String(body ?? '') },
    data: safeData,
    android: {
      priority: 'high',
      notification: {
        channelId: ANDROID_CHANNEL_ID,
        sound: 'default',
      },
    },
  };

  // A transient failure is retried; a token Firebase has permanently rejected is
  // retired instead, so the next send does not keep addressing it.
  const { sent, dead, unretried } = await sendMulticastWithRetry(
    client,
    devices.map((d) => d.fcmToken),
    message
  );

  if (dead.length) {
    await UserDevice.updateMany({ fcmToken: { $in: dead } }, { $set: { isActive: false } });
  }
  if (unretried) console.error(`[fcm] ${unretried} device(s) still failing after ${FCM_ATTEMPTS} attempts`);

  return { sent, failed: dead.length + unretried };
}

export default { sendToUserDevices, buildPushData, ANDROID_CHANNEL_ID };
