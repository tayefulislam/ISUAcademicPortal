import Notification from '../models/Notification.js';
import { emit } from './notifications/notificationService.js';
import { resolveRoutineAudience } from './notifications/recipientResolver.js';
import { formatInAppTimezone, dhakaClock } from '../utils/academicSchedule.js';

// Fan-out for class-routine and academic-event changes. One place decides who
// hears about a cancellation, a move or a room change, so the reminder engine
// and the write paths cannot target different populations.

/** The shared template vars for an occurrence — course, room, and when. */
export function eventVars(entry, extra = {}) {
  const courseCode = entry.course?.courseId || '';
  const courseName = entry.course?.name || '';
  const isInstance = Boolean(entry.startTime && entry.date);

  return {
    courseCode,
    courseName,
    title: courseName || courseCode || 'Class',
    room: entry.roomNumber || '',
    // An online/hybrid class has no room (or a room only for the in-person
    // half), so the delivery mode has to travel with the reminder — otherwise
    // an online reminder reads as if it were in a room. `onlineLink` rides along
    // so a client can offer to join straight from the notification.
    mode: entry.deliveryMode || '',
    onlineLink: entry.onlineLink || '',
    // Reminders want the clock ("at 10:00"); cancellation/reschedule want the
    // full Dhaka timestamp so "which day" is never ambiguous.
    when: isInstance ? `${entry.date} ${dhakaClock(entry.startAt)}` : formatInAppTimezone(entry.startAt),
    routineId: entry.template ? String(entry.template) : String(entry._id),
    eventId: String(entry._id),
    eventType: entry.eventType || 'CLASS',
    ...extra,
  };
}

/** The types that describe a class which has not happened yet. */
const REMINDER_TYPES = ['CLASS_REMINDER', 'CLASS_STARTING', 'EXAM_REMINDER'];

/**
 * The idempotency slot for a class-change notification: the changed fields and
 * the values they now hold, plus the effective start instant.
 *
 * Change notifications used to pass no slot at all, so their key collapsed to
 * (recipient, type, entity, '') and the *second* edit of the same kind was
 * silently dropped — move a class twice, or change its room twice, and only the
 * first ever reached anyone. Keying on the resulting state makes every genuine
 * change a new row, while re-applying an identical change stays a no-op.
 */
export function changeSlot(entry, fields = []) {
  const state = [...new Set(fields)]
    .sort()
    .map((field) => `${field}=${entry[field] ?? ''}`)
    .join('|');
  const start = entry.startAt ? new Date(entry.startAt).toISOString() : '';
  return `${start}#${state}`;
}

/**
 * Drops the not-yet-fired reminders for one entry.
 *
 * A reminder is only true until its class is moved, cancelled or deleted.
 * Leaving the row behind puts a stale "starts in 30 minutes" in the list — and
 * in the unread count — forever, because a later scan only skips what it finds;
 * it never removes what it already created. So the writes that invalidate a
 * reminder are what have to remove it. Reminder types only: cancelling a class
 * must not delete the cancellation notice itself.
 */
export async function purgePendingReminders(entry, entityType = null) {
  if (!entry?._id) return 0;
  return purgePendingRemindersFor(
    [entry._id],
    entityType || (entry.eventType ? 'AcademicEvent' : 'ScheduleInstance')
  );
}

/** The same, for a batch of ids — the occurrences a rule edit just removed. */
export async function purgePendingRemindersFor(ids, entityType = 'ScheduleInstance') {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return 0;
  const result = await Notification.deleteMany({
    entityType,
    entityId: { $in: list },
    type: { $in: REMINDER_TYPES },
  });
  return result.deletedCount || 0;
}

/**
 * Notifies the students an occurrence concerns.
 *
 * Idempotency is the existing Notification unique index
 * ({recipient, type, entityType, entityId, slot}) — the occurrence id is the
 * entity, so a retried cancel/reschedule cannot double-send. Reminders pass a
 * `slot` (offset + effective start) so the several reminders one class produces
 * over time are distinct rows, and a moved class gets a fresh one.
 *
 * `AcademicEvent` documents carry their own `eventType` field and routine
 * occurrences do not, which is what distinguishes the two here without every
 * caller having to say which collection it loaded from.
 */
export async function notifyOccurrence(entry, type, { actorId = null, entityType = null, extraVars = {}, slot = '' } = {}) {
  const recipients = await resolveRoutineAudience({
    course: entry.course?._id || entry.course || null,
    // Only used when the entry has no course (a general academic event).
    department: entry.department?._id || entry.department || null,
    batches: entry.batch ? [entry.batch] : [],
    semesters: entry.semester ? [entry.semester] : [],
    groups: entry.group ? [entry.group] : [],
  });
  if (!recipients.length) return { created: 0, pushed: 0 };

  const resolvedEntityType = entityType || (entry.eventType ? 'AcademicEvent' : 'ScheduleInstance');

  // `pushed` is forwarded as well as `created`: the caller's summary reports
  // both, and that is how a repeated cron tick is visible as doing nothing
  // (0 created, 0 pushed) rather than looking identical to a working one.
  return emit({
    type,
    actorId,
    entityType: resolvedEntityType,
    entityId: entry._id,
    slot,
    course: entry.course?._id || entry.course || null,
    department: entry.department?._id || entry.department || null,
    vars: eventVars(entry, extraVars),
    recipients,
  });
}
