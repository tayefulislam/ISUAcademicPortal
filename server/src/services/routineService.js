import ScheduleInstance from '../models/ScheduleInstance.js';
import AcademicEvent from '../models/AcademicEvent.js';
import { ApiError } from '../utils/ApiError.js';
import { INHERITED_FIELDS } from '../utils/academicEventTypes.js';
import { eachDateInclusive, weekdayOf, combineDhakaDateTime, startOfDhakaDay, isDateOnly } from '../utils/academicSchedule.js';

// Materialising a recurring rule, and refusing (or flagging) a double-booking.
// Both live here rather than in the controller so the reminder engine and any
// future import tool go through the same rules.

/** The inherited fields that are free-text rather than a ref or an enum. */
const STRING_FIELDS = new Set(['group', 'roomNumber', 'startTime', 'endTime', 'onlineLink']);

/** Whether an occurrence's current value already equals the routine's. */
function sameFieldValue(current, next) {
  if (next === null || next === undefined) return current === null || current === undefined || current === '';
  if (current === null || current === undefined) return false;
  return String(current) === String(next);
}

/**
 * The values an occurrence should end up with: whatever it changed for itself,
 * and the routine's value for everything else — "override if present, else
 * inherit".
 *
 * This is the single definition of that rule. The generator, the cascade and the
 * per-date reset all go through it, so none of them can drift from the others.
 *
 * @param {object} instance        the occurrence (a fresh `{date}` is fine)
 * @param {object} template        the recurring rule it belongs to
 * @param {string[]} [overriddenFields] defaults to the instance's own set
 * @returns {{patch:object, changedFields:string[]}} the fields to write, and
 *   which *inherited* fields among them actually differ from what is held today
 *   (the derived `startAt`/`endAt` are in `patch` but never in `changedFields`).
 */
export function withInheritedValues(instance, template, overriddenFields = instance.overriddenFields || []) {
  const overridden = new Set(overriddenFields);
  const patch = {};
  const changedFields = [];

  for (const field of INHERITED_FIELDS) {
    if (overridden.has(field)) continue;
    const next = STRING_FIELDS.has(field) ? (template[field] ?? '') : (template[field] ?? null);
    if (sameFieldValue(instance[field], next)) continue;
    patch[field] = next;
    changedFields.push(field);
  }

  // The UTC instants are derived, not inherited, so they are recomputed from the
  // date the occurrence actually sits on plus whichever times it ended up with.
  if (patch.startTime !== undefined || patch.endTime !== undefined) {
    const startTime = patch.startTime ?? instance.startTime;
    const endTime = patch.endTime ?? instance.endTime;
    patch.startAt = combineDhakaDateTime(instance.date, startTime);
    patch.endAt = combineDhakaDateTime(instance.date, endTime);
  }

  return { patch, changedFields };
}

/** A date the rule no longer covers: its weekday was unselected, or the range moved past it. */
function isOrphanInstance(instance, template) {
  if (!template.days.includes(weekdayOf(instance.date))) return true;
  if (template.startDate && instance.date < template.startDate) return true;
  if (template.endDate && instance.date > template.endDate) return true;
  return false;
}

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

  const docs = pending.map((date) => ({
    template: template._id,
    department: template.department,
    batch: template.batch,
    semester: template.semester,
    course: template.course,
    date,
    // A date that has just come into range inherits everything, so the same rule
    // that keeps an edited routine in sync builds the document in the first
    // place. The instants come from here rather than the schema hook because
    // insertMany() is a bulk path.
    ...withInheritedValues({ date, overriddenFields: [] }, template).patch,
    status: 'NORMAL',
    createdBy: actorId,
  }));

  const inserted = await ScheduleInstance.insertMany(docs, { ordered: false });
  return { created: inserted.length, skipped: dates.length - inserted.length };
}

/**
 * Brings an edited routine's future occurrences into line with it — the
 * "automatic synchronisation" half of the master/occurrence model.
 *
 * For every occurrence at or after `from`:
 *  - a field it individually changed is left alone;
 *  - every other inherited field is rewritten to the routine's current value;
 *  - a date the rule no longer covers (weekday unselected, or outside the range)
 *    is deleted, but only while it is still a plain NORMAL copy — an occurrence
 *    carrying an exception is kept so an administrator's change is never
 *    silently discarded.
 *
 * `from` is what makes "future only" the default: pass the start of the next
 * occurrence, today, a chosen date, or `new Date(0)` to reach back into history.
 *
 * @returns {Promise<{updated:number, removed:number, unchanged:number, changed:Array<{id:string, fields:string[]}>}>}
 */
export async function syncInstancesWithTemplate(template, { from = null, actorId = null } = {}) {
  const instances = await ScheduleInstance.find({
    template: template._id,
    ...(from ? { startAt: { $gte: from } } : {}),
  });

  const operations = [];
  const changed = [];

  for (const instance of instances) {
    const { patch, changedFields } = withInheritedValues(instance, template);
    const exceptions = instance.overriddenFields || [];

    if (isOrphanInstance(instance, template) && !exceptions.length && instance.status === 'NORMAL') {
      operations.push({ deleteOne: { filter: { _id: instance._id } } });
      continue;
    }

    if (!Object.keys(patch).length) continue;

    operations.push({
      updateOne: {
        filter: { _id: instance._id },
        // bulkWrite skips the schema hook, so startAt/endAt are computed by
        // withInheritedValues rather than derived on save.
        update: { $set: { ...patch, updatedBy: actorId } },
      },
    });

    // The value each changed field held before, so a caller can say what the
    // class moved from as well as what it moved to.
    const before = {};
    for (const field of changedFields) before[field] = instance[field];
    changed.push({ id: String(instance._id), fields: changedFields, before });
  }

  if (!operations.length) {
    return { updated: 0, removed: 0, unchanged: instances.length, changed: [] };
  }

  const result = await ScheduleInstance.bulkWrite(operations, { ordered: false });
  const removed = result.deletedCount || 0;

  return {
    updated: result.modifiedCount || 0,
    removed,
    unchanged: instances.length - changed.length - removed,
    changed,
  };
}

/**
 * The instant a routine edit starts applying from.
 *
 * `all` — "All future classes" — is the default: history is rewritten only when
 * the caller explicitly asks for it with `entire`.
 *
 * @param {object} template
 * @param {{scope?:string, date?:string|null, now?:Date}} [opts]
 * @returns {Promise<Date>}
 */
export async function applyBoundaryFor(template, { scope = 'all', date = null, now = new Date() } = {}) {
  switch (scope) {
    case 'entire':
      return new Date(0);
    case 'today':
      return startOfDhakaDay(now);
    case 'date':
      if (!isDateOnly(date)) {
        throw new ApiError(400, 'applyFromDate must be YYYY-MM-DD when applyFrom is "date"');
      }
      return combineDhakaDateTime(date, '00:00');
    case 'next': {
      const next = await ScheduleInstance.findOne({ template: template._id, startAt: { $gte: now } })
        .sort({ startAt: 1 })
        .select('startAt');
      return next ? next.startAt : now;
    }
    case 'all':
    default:
      return now;
  }
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
