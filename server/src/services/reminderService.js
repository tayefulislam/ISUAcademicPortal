import ScheduleInstance from '../models/ScheduleInstance.js';
import AcademicEvent from '../models/AcademicEvent.js';
import { notifyOccurrence } from './routineNotifications.js';
import { addMinutes, formatInAppTimezone, dhakaClock } from '../utils/academicSchedule.js';

// The reminder engine. There is no scheduler in this stack, so this is written
// as a *pure function of now* that a cron hit drives — every run recomputes
// what is due rather than relying on a timer having fired.
//
// Idempotency is the Notification unique index, not bookkeeping here: every
// reminder carries a `slot` of its offset plus the instant it counts down to
// (see reminderSlot below), so re-running the endpoint inside the same window
// re-attempts the insert and the duplicate is rejected by the index. A
// duplicated tick therefore cannot double-notify, and because the offsets'
// windows partition the countdown (see REMINDER_OFFSETS below) a delayed tick
// still lands in exactly one of them rather than being dropped or sent early.
//
// Two offsets for one class are two different slots, so the 30- and 10-minute
// reminders are genuinely separate notifications; and once a class is moved its
// reminder counts down to a different instant, so a new reminder is created
// rather than being swallowed by the one that has already fired. That is the
// invalidate-then-recreate behaviour the spec asks for.

// Each offset owns the stretch of the countdown between its own target and the
// next nearer one, i.e. roughly `(fromMinutes, minutesBefore]` before the class.
// That partition is what makes the arithmetic honest:
//   * the upper bound is the target itself, so an offset never fires early (the
//     old symmetric ±5 window sent "starts in 30 minutes" at 35 minutes out);
//   * the lower bound is the next offset's target, so the 10-minute reminder
//     cannot also fire at 0 minutes and the "starting now" one cannot fire early;
//   * any distance is covered by exactly one offset, so a tick delayed by several
//     minutes still lands somewhere rather than dropping the reminder — and when
//     it does, the message reports the true remaining time, not the offset's.
// The 0-offset's floor is negative so a slightly late tick still says "starting
// now", without a long-past class ever doing so.
export const REMINDER_OFFSETS = [
  { minutesBefore: 30, type: 'CLASS_REMINDER', fromMinutes: 10 },
  { minutesBefore: 10, type: 'CLASS_REMINDER', fromMinutes: 0 },
  { minutesBefore: 0, type: 'CLASS_STARTING', fromMinutes: -2 },
];

/**
 * The idempotency slot for one reminder: the offset plus the instant the class
 * actually starts. Deterministic, so the same tick in the same window is a
 * no-op; different for the same offset once the class has moved, so the reminder
 * for the new time cannot be mistaken for the one already sent for the old.
 */
function reminderSlot(minutesBefore, startAt) {
  return `${minutesBefore}@${new Date(startAt).toISOString()}`;
}

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
  const summary = { scanned: 0, sent: 0, pushed: 0, offsets: [] };

  for (const { minutesBefore, type, fromMinutes } of REMINDER_OFFSETS) {
    // The offset's stretch of the countdown: nearer than the offset (inclusive)
    // but not nearer than the next offset, which owns that stretch instead.
    const from = addMinutes(now, fromMinutes);
    const to = addMinutes(now, minutesBefore);

    const query = {
      // A cancelled occurrence never reminds anyone.
      status: { $nin: ['CANCELLED'] },
      startAt: { $gt: from, $lte: to },
    };

    const [instances, events] = await Promise.all([
      ScheduleInstance.find(query).populate(POPULATE),
      // Only one-off *classes* get class reminders. An exam, deadline or general
      // event that happens to fall in this window is not a class and must not be
      // told it is one; exams are covered by runExamReminders instead.
      AcademicEvent.find({ ...query, eventType: 'CLASS' }).populate(POPULATE),
    ]);

    const due = [...instances, ...events];
    summary.scanned += due.length;

    let sent = 0;
    let pushed = 0;
    for (const entry of due) {
      // Report what is actually true at send time rather than the offset that
      // triggered it: a tick that runs a few minutes late then still produces an
      // honest countdown instead of claiming the class is further away than it is.
      const minutesAway = Math.max(0, Math.round((new Date(entry.startAt).getTime() - now.getTime()) / 60000));
      const result = await notifyOccurrence(entry, type, {
        slot: reminderSlot(minutesBefore, entry.startAt),
        extraVars: {
          minutesBefore: minutesAway,
          // The clock time; the 0-minute template phrases itself as
          // "starting now", which is why `minutesBefore` is only used by the
          // 30/10-minute template.
          when: dhakaClock(entry.startAt),
          startTime: dhakaClock(entry.startAt),
          endTime: dhakaClock(entry.endAt),
        },
      });
      sent += result?.created || 0;
      pushed += result?.pushed || 0;
    }

    summary.offsets.push({ minutesBefore, type, matched: due.length, recipients: sent, pushed });
    summary.sent += sent;
    summary.pushed += pushed;
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
  // A day-ahead reminder states no countdown, so the window can be symmetric —
  // a tick up to five minutes either side of the exact 24-hour mark still counts.
  const examTolerance = 5;
  const window = {
    status: { $nin: ['CANCELLED'] },
    startAt: { $gte: addMinutes(dayBefore, -examTolerance), $lte: addMinutes(dayBefore, examTolerance) },
  };

  const events = await AcademicEvent.find({ ...window, eventType: 'EXAM' }).populate(POPULATE);

  let sent = 0;
  for (const entry of events) {
    const result = await notifyOccurrence(entry, 'EXAM_REMINDER', {
      // A day-ahead reminder is one slot per exam; a moved exam gets its own.
      slot: reminderSlot(24 * 60, entry.startAt),
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
