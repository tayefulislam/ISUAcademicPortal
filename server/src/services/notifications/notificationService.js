import mongoose from 'mongoose';
import Notification from '../../models/Notification.js';
import User from '../../models/User.js';
import { env } from '../../config/env.js';
import { renderTemplate } from './notificationTemplates.js';
import { sendToUser } from './pushService.js';
import { sendToUserDevices, buildPushData } from './fcmService.js';
import { sendEmail } from '../email/emailService.js';
import { notificationEmail } from '../email/templates.js';

// A user's `notificationPreferences.types` Map only exists on documents
// created after that field was added — missing means "never explicitly
// turned off" (opt-out model, matches every other feature-flag default in
// this app), so absence reads as enabled, not disabled.
function typeEnabledFor(user, type) {
  if (type === 'SYSTEM') return true; // mandatory, spec §12
  const pref = user.notificationPreferences?.types?.get?.(type);
  return pref !== false;
}

function pushEnabledFor(user) {
  return user.notificationPreferences?.push !== false;
}

function emailEnabledFor(user) {
  return user.notificationPreferences?.email !== false;
}

// Time-based class reminders are push/in-app only. Three of them fire per class
// (30, 10 and 0 minutes), and emailing each would be a flood nobody opted into —
// the email copy is meant for the event-style notifications, not the ticking ones.
const EMAIL_EXCLUDED_TYPES = new Set(['CLASS_REMINDER', 'CLASS_STARTING']);

// Fan-out runs in bounded batches. A broadcast to every student would otherwise
// issue one device lookup (and one socket write) per recipient all at once, while
// the admin "send now" endpoint awaits the whole thing inside its HTTP request —
// enough concurrency to swamp the pool for a message that has no deadline.
const FANOUT_BATCH_SIZE = 25;

async function forEachBatch(items, size, worker) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.allSettled(items.slice(i, i + size).map(worker));
  }
}

/**
 * The single entry point every controller hook calls. Never throws to the
 * caller in practice (callers wrap it in `.catch()` and never await it —
 * see the fire-and-forget convention introduced across the hook points),
 * but is written to also behave correctly if awaited directly (e.g. from
 * tests or the admin "send now" endpoint).
 *
 * @param {object} event
 * @param {string} event.type - one of NOTIFICATION_TYPES
 * @param {string|ObjectId|null} [event.actorId] - who caused this (null = system)
 * @param {string} [event.entityType] - e.g. 'FILE', 'ASSIGNMENT', 'QUIZ_ATTEMPT'
 * @param {string|ObjectId} [event.entityId] - the entity's id; if omitted, a
 *   fresh id is generated so idempotency never accidentally collides two
 *   unrelated ad-hoc events (e.g. two separate admin broadcasts) together.
 * @param {string|ObjectId} [event.course]
 * @param {string|ObjectId} [event.department]
 * @param {object} [event.vars] - template variables (see notificationTemplates.js)
 * @param {string} [event.slot] - a further discriminator within one
 *   (recipient, type, entity). Only reminders use it: the offset plus the
 *   occurrence's effective start instant, so two offsets for the same class are
 *   two notifications and a moved class produces a new one instead of colliding
 *   with the reminder that already fired. Empty for everything else.
 * @param {Array<string|ObjectId>} event.recipients - resolved recipient ids
 *   (use recipientResolver.js to build this — never take a raw list from
 *   client input except for the gated admin "send to specific user" case).
 */
export async function emit({ type, actorId = null, entityType = '', entityId = null, slot = '', course = null, department = null, vars = {}, recipients }) {
  const requested = [...new Set((recipients || []).map(String))].filter((id) => id !== String(actorId));
  if (!requested.length) return { created: 0, pushed: 0, emailed: 0 };

  // Per-type opt-out (Settings -> Notifications) is checked BEFORE creating
  // the in-app row, not just before push — disabling a type means "don't
  // notify me about this at all", not "notify silently in-app only".
  const users = await User.find({ _id: { $in: requested } }).select('notificationPreferences email name');
  const byId = new Map(users.map((u) => [String(u._id), u]));
  const uniqueRecipients = requested.filter((id) => {
    const u = byId.get(id);
    return !u || typeEnabledFor(u, type); // fail-open if the user doc is missing/stale
  });
  if (!uniqueRecipients.length) return { created: 0, pushed: 0, emailed: 0 };

  const { title, message, url } = renderTemplate(type, vars);
  const effectiveEntityId = entityId || new mongoose.Types.ObjectId();

  // The unique index {recipient,type,entityType,entityId,slot} is what makes this
  // atomic, but it is NOT sufficient on its own: an index that failed to build
  // (a deployment whose collection predates it, or one that could not be built
  // because duplicates already existed) silently stops deduping, and every
  // retry then writes another row. One indexed lookup here means a repeated
  // event is a no-op even in that state.
  const existing = await Notification.find({
    recipient: { $in: uniqueRecipients },
    type,
    entityType,
    entityId: effectiveEntityId,
    slot,
  })
    .select('recipient')
    .lean();
  const alreadyNotified = new Set(existing.map((row) => String(row.recipient)));
  const freshRecipients = uniqueRecipients.filter((id) => !alreadyNotified.has(id));

  // Nothing new to say: no row, and crucially no push either — see below.
  if (!freshRecipients.length) return { created: 0, pushed: 0, emailed: 0 };

  const docs = freshRecipients.map((recipient) => ({
    recipient,
    sender: actorId,
    type,
    title,
    message,
    entityType,
    entityId: effectiveEntityId,
    slot,
    course,
    department,
    url,
    metadata: vars,
  }));

  let inserted = [];
  try {
    inserted = await Notification.insertMany(docs, { ordered: false });
  } catch (err) {
    // Partial success is normal here — insertMany with ordered:false still
    // throws once at the end summarizing failures, but successful docs are
    // already written. E11000 entries are the intended dedupe (a retried
    // request for a recipient who was already notified) — anything else is
    // a real problem worth surfacing.
    inserted = err.insertedDocs || [];
    // A MongoBulkWriteError's writeErrors are WriteError wrappers — the
    // actual driver error (code/errmsg) lives on `.err`, not the wrapper
    // itself; reading `.code` directly here always misses and would
    // misclassify every intended dedupe as a "real" error.
    const realErrors = (err.writeErrors || []).filter((e) => (err.err?.code ?? e.code) !== 11000);
    if (realErrors.length) console.error('[notifications] insert errors', realErrors.map((e) => e.err?.errmsg || e.errmsg));
  }

  // Push fan-out — but only for recipients whose row was ACTUALLY created.
  //
  // This is the difference between a notification and a delivery attempt. The
  // in-app row is the system of record; a push is a transport for it, so if
  // there is no new row there is nothing to push. Fanning out from the
  // requested list instead would re-send the same push on every retry — which
  // is exactly what a per-minute cron does inside a reminder window, and it
  // meant a "class starts in 10 minutes" reminder arriving every minute even
  // though its notification had been correctly deduped.
  const createdIds = new Set(inserted.map((doc) => String(doc.recipient)));
  const toPush = freshRecipients
    .filter((id) => createdIds.has(id))
    .map((id) => byId.get(id))
    .filter((u) => u && pushEnabledFor(u));

  await forEachBatch(toPush, FANOUT_BATCH_SIZE, (u) =>
    sendToUser(u._id, { title, body: message, url, type })
  );

  // FCM is a second *transport* for the same event, not a second notification
  // system: it carries the id of the row just created (plus the ids the Android
  // client needs to open the right screen), so tapping a push opens/marks the
  // real Notification record. Same recipients and same pushEnabledFor() policy as
  // Web Push, so the two channels can never disagree about who is notified.
  // Silently no-ops when no Firebase service account is configured.
  const notificationIdByRecipient = new Map(
    inserted.map((doc) => [String(doc.recipient), String(doc._id)])
  );
  await forEachBatch(toPush, FANOUT_BATCH_SIZE, (u) =>
    sendToUserDevices(u._id, {
      title,
      body: message,
      data: buildPushData({
        notificationId: notificationIdByRecipient.get(String(u._id)),
        type,
        entityType,
        entityId: String(effectiveEntityId),
        url,
        vars,
      }),
    })
  );

  // Email is a third transport for the same event, honouring the user's own
  // `email` preference (which used to be stored and echoed but read by nothing).
  // Only recipients whose row was actually created are mailed, so a retried event
  // cannot send a second copy. Best-effort and batched: an SMTP failure must not
  // fail the notification, and with no mail credentials sendEmail logs to the
  // console instead of sending (see services/email/emailService.js) — so this is
  // safe to run in every environment.
  //
  // The whole channel sits behind NOTIFICATION_EMAIL_ENABLED (off by default):
  // the in-app row, Web Push and FCM above are unaffected, so an event still
  // reaches people while the email copy is switched off.
  const toEmail = !env.notifications.emailEnabled || EMAIL_EXCLUDED_TYPES.has(type)
    ? []
    : freshRecipients
        .filter((id) => createdIds.has(id))
        .map((id) => byId.get(id))
        .filter((u) => u && u.email && emailEnabledFor(u));
  if (toEmail.length) {
    const base = env.clientUrls?.[0] || '';
    const link = url && url.startsWith('/') ? `${base}${url}` : url;
    const mail = notificationEmail({ title, message, url: link });
    await forEachBatch(toEmail, FANOUT_BATCH_SIZE, (u) =>
      sendEmail({ to: u.email, subject: mail.subject, html: mail.html, text: mail.text })
        .catch((err) => console.error('[notifications] email failed', u.email, err?.message || err))
    );
  }

  return { created: inserted.length, pushed: toPush.length, emailed: toEmail.length };
}

export default { emit };
