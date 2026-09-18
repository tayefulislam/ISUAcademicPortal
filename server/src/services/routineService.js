import ScheduleInstance from '../models/ScheduleInstance.js';
import AcademicEvent from '../models/AcademicEvent.js';
import { eachDateInclusive, weekdayOf, combineDhakaDateTime, normalizeTime } from '../utils/academicSchedule.js';

// Materialising a recurring rule, and refusing (or flagging) a double-booking.
// Both live here rather than in the controller so the reminder engine and any
// future import tool go through the same rules.

/**
 * Turns a recurring template into the dated occurrences it describes, for every
 * date in its range that falls on one of its weekdays.
 *
 * Idempotent by design: dates that already have an instance are skipped, so
 * re-running this after editing a template's course/room never duplicates the
 * series — and never overwrites an occurrence that was individually cancelled or
 * moved, because those exceptions are exactly what the instance documents hold.
 *
 * @returns {{created:number, skipped:number}}
 */
export async function generateInstancesForTemplate(template, actorId) {
  const dates = eachDateInclusive(template.startDate, template.endDate)
    .filter((date) => template.days.includes(weekdayOf(date)));
  if (!dates.length) return { created: 0, skipped: 0 };

  const existing = await ScheduleInstance.find({ template: template._id, date: { $in: dates } }).select('date');
  const taken = new Set(existing.map((row) => row.date));
  const pending = dates.filter((date) => !taken.has(date));
  if (!pending.length) return { created: 0, skipped: dates.length };

  const startTime = normalizeTime(template.startTime);
  const endTime = normalizeTime(template.endTime);

  const docs = pending.map((date) => ({
    template: template._id,
    department: template.department,
    batch: template.batch,
    semester: template.semester,
    course: template.course,
    group: template.group,
    faculty: template.faculty,
    roomNumber: template.roomNumber,
    date,
    startTime,
    endTime,
    // Derived here as well as in the schema hook: insertMany() is a bulk path,
    // and the instants are the fields every query depends on.
    startAt: combineDhakaDateTime(date, startTime),
    endAt: combineDhakaDateTime(date, endTime),
    classType: template.classType,
    deliveryMode: template.deliveryMode,
    onlineLink: template.onlineLink,
    status: 'NORMAL',
    createdBy: actorId,
  }));

  const inserted = await ScheduleInstance.insertMany(docs, { ordered: false });
  return { created: inserted.length, skipped: dates.length - inserted.length };
}

/** Overlap test for two windows — half-open, so back-to-back slots never clash. */
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

async function clash(model, filter, candidate, kind) {
  const rows = await model
    .find({
      ...filter,
      // A cancelled occurrence is not occupying the room or the faculty member.
      status: { $nin: ['CANCELLED'] },
      startAt: { $lt: candidate.endAt },
      endAt: { $gt: candidate.startAt },
    })
    .select('date startAt endAt roomNumber faculty course')
    .limit(5);

  return rows
    .filter((row) => overlaps(
      new Date(candidate.startAt).getTime(), new Date(candidate.endAt).getTime(),
      new Date(row.startAt).getTime(), new Date(row.endAt).getTime()
    ))
    .map((row) => ({
      kind,
      id: String(row._id),
      date: row.date,
      roomNumber: row.roomNumber,
      startAt: row.startAt,
      endAt: row.endAt,
    }));
}

/**
 * Double-bookings for a set of candidate slots: the same room in the same
 * department, or the same faculty member in any department.
 *
 * Checked across BOTH collections — an exam booked into a room collides with a
 * class in that room just as surely as another class does.
 *
 * @param {Array} candidates  plain objects with {department, roomNumber, faculty, startAt, endAt, _id?}
 * @param {object} [opts]     `excludeIds` — instance/event ids to ignore (the row being edited)
 * @returns {Promise<Array<{kind:string,id:string,date:string,roomNumber:string,startAt:Date,endAt:Date}>>}
 */
export async function findConflicts(candidates, { excludeIds = [] } = {}) {
  const excluded = excludeIds.map(String);
  const conflicts = [];

  for (const candidate of candidates) {
    if (!candidate.startAt || !candidate.endAt) continue;

    const roomFilter = candidate.roomNumber
      ? { department: candidate.department, roomNumber: candidate.roomNumber }
      : null;
    const facultyFilter = candidate.faculty ? { faculty: candidate.faculty } : null;

    for (const model of [ScheduleInstance, AcademicEvent]) {
      if (roomFilter) conflicts.push(...await clash(model, roomFilter, candidate, 'ROOM'));
      if (facultyFilter) conflicts.push(...await clash(model, facultyFilter, candidate, 'FACULTY'));
    }
  }

  // De-duplicate: a room clash and a faculty clash on the same row both matter,
  // but the same row reported twice for the same kind does not.
  const seen = new Set();
  return conflicts.filter((c) => {
    const key = `${c.kind}:${c.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return !excluded.includes(String(c.id));
  });
}
