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
    // Reminders want the clock ("at 10:00"); cancellation/reschedule want the
    // full Dhaka timestamp so "which day" is never ambiguous.
    when: isInstance ? `${entry.date} ${dhakaClock(entry.startAt)}` : formatInAppTimezone(entry.startAt),
    routineId: entry.template ? String(entry.template) : String(entry._id),
    eventId: String(entry._id),
    eventType: entry.eventType || 'CLASS',
    ...extra,
  };
}

/**
 * Notifies the students an occurrence concerns.
 *
 * Idempotency is the existing Notification unique index
 * ({recipient, type, entityType, entityId}) — the occurrence id is the entity,
 * so a retried cancel/reschedule cannot double-send.
 *
 * `AcademicEvent` documents carry their own `eventType` field and routine
 * occurrences do not, which is what distinguishes the two here without every
 * caller having to say which collection it loaded from.
 */
export async function notifyOccurrence(entry, type, { actorId = null, entityType = null, extraVars = {} } = {}) {
  const recipients = await resolveRoutineAudience({
    course: entry.course?._id || entry.course || null,
    // Only used when the entry has no course (a general academic event).
    department: entry.department?._id || entry.department || null,
    batches: entry.batch ? [entry.batch] : [],
    semesters: entry.semester ? [entry.semester] : [],
    groups: entry.group ? [entry.group] : [],
  });
  if (!recipients.length) return { created: 0 };

  const resolvedEntityType = entityType || (entry.eventType ? 'AcademicEvent' : 'ScheduleInstance');

  const { created } = await emit({
    type,
    actorId,
    entityType: resolvedEntityType,
    entityId: entry._id,
    course: entry.course?._id || entry.course || null,
    department: entry.department?._id || entry.department || null,
    vars: eventVars(entry, extraVars),
    recipients,
  });

  return { created };
}
