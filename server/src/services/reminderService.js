import ScheduleInstance from '../models/ScheduleInstance.js';
import AcademicEvent from '../models/AcademicEvent.js';
import { notifyOccurrence } from './routineNotifications.js';
import { addMinutes, formatInAppTimezone, dhakaClock } from '../utils/academicSchedule.js';

// The reminder engine. There is no scheduler in this stack, so this is written
// as a *pure function of now* that a cron hit drives — every run recomputes
// what is due rather than relying on a timer having fired.
//
// Idempotency is the Notification unique index, not bookkeeping here: each
// reminder offset is its own notification TYPE (CLASS_REMINDER for 30 minutes,
// CLASS_STARTING for 0), so re-running the endpoint inside the same window
// re-attempts the insert and the duplicate is rejected by the index. That means
// a missed cron tick is harmless — the next one still catches the window — and
// a duplicated tick cannot double-notify.

export const REMINDER_OFFSETS = [
  { minutesBefore: 30, type: 'CLASS_REMINDER' },
  { minutesBefore: 10, type: 'CLASS_REMINDER' },
  { minutesBefore: 0, type: 'CLASS_STARTING' },
];

/**
 * The window to scan. Deliberately a little wider than the offsets themselves:
 * a cron that runs every minute will normally see an exact match, but a tick
 * delayed by a few minutes must still fire the reminder it slept through.
 */
const WINDOW_TOLERANCE_MINUTES = 5;

const POPULATE = [
  { path: 'course', select: 'name courseId' },
  { path: 'department', select: 'name code' },
];

/**
 * Fires every reminder due at `now`.
 *
 * @returns {Promise<{scanned:number, sent:number, offsets:object[]}>}
 */
export async function runDueReminders(now = new Date()) {
  const summary = { scanned: 0, sent: 0, offsets: [] };

  for (const { minutesBefore, type } of REMINDER_OFFSETS) {
    const target = addMinutes(now, minutesBefore);
    const from = addMinutes(target, -WINDOW_TOLERANCE_MINUTES);
    const to = addMinutes(target, WINDOW_TOLERANCE_MINUTES);

    const query = {
      // A cancelled occurrence never reminds anyone.
      status: { $nin: ['CANCELLED'] },
      startAt: { $gte: from, $lte: to },
    };

    const [instances, events] = await Promise.all([
      ScheduleInstance.find(query).populate(POPULATE),
      AcademicEvent.find(query).populate(POPULATE),
    ]);

    const due = [...instances, ...events];
    summary.scanned += due.length;

    let sent = 0;
    for (const entry of due) {
      const result = await notifyOccurrence(entry, type, {
        extraVars: {
          minutesBefore,
          // The clock time; the 0-minute template phrases itself as
          // "starting now", which is why `minutesBefore` is only used by the
          // 30/10-minute template.
          when: dhakaClock(entry.startAt),
          startTime: dhakaClock(entry.startAt),
          endTime: dhakaClock(entry.endAt),
        },
      });
      sent += result?.created || 0;
    }

    summary.offsets.push({ minutesBefore, type, matched: due.length, recipients: sent });
    summary.sent += sent;
  }

  return summary;
}

/**
 * Exam reminders — the `EXAM_REMINDER` type has existed since before this
 * feature but nothing ever emitted it. Sent once, the day before, which is the
 * granularity the spec asks for ("Exam tomorrow").
 */
export async function runExamReminders(now = new Date()) {
  const dayBefore = addMinutes(now, 24 * 60);
  const window = {
    status: { $nin: ['CANCELLED'] },
    startAt: { $gte: addMinutes(dayBefore, -WINDOW_TOLERANCE_MINUTES), $lte: addMinutes(dayBefore, WINDOW_TOLERANCE_MINUTES) },
  };

  const events = await AcademicEvent.find({ ...window, eventType: 'EXAM' }).populate(POPULATE);

  let sent = 0;
  for (const entry of events) {
    const result = await notifyOccurrence(entry, 'EXAM_REMINDER', {
      extraVars: {
        title: entry.title,
        when: formatInAppTimezone(entry.startAt),
      },
    });
    sent += result?.created || 0;
  }

  return { matched: events.length, recipients: sent };
}

export default { runDueReminders, runExamReminders, REMINDER_OFFSETS };
