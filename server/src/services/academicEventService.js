import ScheduleInstance from '../models/ScheduleInstance.js';
import AcademicEvent from '../models/AcademicEvent.js';
import { getRole, isSuperAdminTier } from '../models/Role.js';
import { getEffectiveCourseIds, getAdditionalCourseIds } from './courseAccessService.js';
import { groupFilterFor } from '../utils/groups.js';
import { eventStateFor, eventTypeForClassType } from '../utils/academicEventTypes.js';
import {
  APP_TIMEZONE,
  dhakaDateString,
  startOfDhakaDay,
  endOfDhakaDay,
  dhakaClock,
  combineDhakaDateTime,
  weekdayOf,
} from '../utils/academicSchedule.js';

// The single place that answers "what events can this person see, and which one
// is on now". The web client, the Android app, the calendar and the reminder
// engine all read through here, so they can never disagree about which class is
// current — which is the failure the spec calls out explicitly (§23).

const POPULATE = [
  { path: 'course', select: 'name courseId' },
  { path: 'faculty', select: 'name' },
  { path: 'department', select: 'name code' },
  { path: 'batch', select: 'name code' },
  { path: 'semester', select: 'name code' },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** How far ahead the widget looks for a "next" event (spec §14: tomorrow still counts). */
const NEXT_LOOKAHEAD_DAYS = 30;

/** An admin-tier role with an explicit routine_view grant sees beyond their own timetable. */
async function hasBroadRoutineView(user) {
  if (!user) return false;
  if (isSuperAdminTier(user.role)) return true;
  if (user.role === 'admin' || user.role === 'faculty' || user.role === 'student') return false;
  const role = await getRole(user.role);
  return Boolean(role && role.permissions.includes('routine_view'));
}

/**
 * The Mongo filter for the entries this user may see — derived from the
 * authenticated user's own record, never from a query parameter (spec §32).
 * Returns `null` for an unrestricted viewer.
 *
 * Students (and CR accounts, which keep the placement they had before
 * promotion) match on the four axes the spec lists, with the course axis
 * honoured the same way Files/Assignments/Quizzes do it: a student sees an
 * entry for their own department, or for a course they can actually reach —
 * which is what keeps a cross-department retake visible without opening every
 * other department's timetable to them.
 *
 * Faculty see only entries they are the named teacher on. Course access is
 * deliberately not sufficient (spec §11, §42).
 */
export async function audienceFilterFor(user) {
  if (!user) return { _id: null };

  if (user.role === 'faculty') {
    return { faculty: user._id };
  }

  if (await hasBroadRoutineView(user)) {
    return null;
  }

  const groupFilter = groupFilterFor(user);

  // The student's own cohort — batch and semester are the two axes everything
  // scheduled for their placement carries, so they stay a hard match here.
  // `group` is absent when the student is in BOTH: they are in the whole batch,
  // so no entry is excluded on the group axis.
  const cohort = {
    batch: user.batch,
    semester: user.semester,
    ...(groupFilter ? { group: groupFilter } : {}),
  };

  const scope = [];
  if (user.department) scope.push({ department: user.department });
  const courseIds = await getEffectiveCourseIds(user);
  if (courseIds.length) scope.push({ course: { $in: courseIds } });

  // A student with no department and no reachable course sees nothing; an
  // impossible clause is clearer than returning every entry.
  if (!scope.length) return { _id: null };

  const clauses = [{ ...cohort, $or: scope }];

  // A course the student is explicitly enrolled in *additionally*
  // (retake/extra/backlog/improvement/advance) is its own grant — the
  // enrollment itself puts them in that course, so the cohort axes must not
  // filter the class back out. That is the whole point of such an enrollment:
  // it is taken "out of sync" with the student's own batch/semester, and the
  // class is therefore scheduled under a different cohort than theirs. Only the
  // course axis survives here, and the clause is purely additive — everything
  // the cohort clause already matched stays matched, and nothing else is
  // widened (a department course in another semester is still invisible unless
  // it is one of these explicit enrollments).
  const additionalCourseIds = await getAdditionalCourseIds(user);
  if (additionalCourseIds.length) {
    clauses.push({
      course: { $in: additionalCourseIds },
      ...(groupFilter ? { group: groupFilter } : {}),
    });
  }

  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

/** One shape for both collections, so a client never needs to know the source. */
function toView(doc, source, now) {
  const isRoutine = source === 'ROUTINE';
  const status = doc.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE';

  return {
    id: String(doc._id),
    source,
    eventType: isRoutine ? eventTypeForClassType(doc.classType) : doc.eventType,
    classType: doc.classType,
    title: isRoutine ? (doc.course?.name || 'Class') : doc.title,

    course: doc.course
      ? { id: String(doc.course._id), code: doc.course.courseId, name: doc.course.name }
      : null,
    faculty: doc.faculty ? { id: String(doc.faculty._id), name: doc.faculty.name } : null,
    department: doc.department ? { id: String(doc.department._id), code: doc.department.code, name: doc.department.name } : null,
    batch: doc.batch ? { id: String(doc.batch._id), code: doc.batch.code, name: doc.batch.name } : null,
    semester: doc.semester ? { id: String(doc.semester._id), code: doc.semester.code, name: doc.semester.name } : null,

    group: doc.group,
    room: doc.roomNumber || '',
    mode: doc.deliveryMode,
    onlineLink: doc.onlineLink || '',

    date: doc.date,
    startAt: doc.startAt,
    endAt: doc.endAt,
    // Wall-clock strings come from the same instant the client counts down to,
    // so the label and the progress bar can never disagree.
    startTime: dhakaClock(doc.startAt),
    endTime: dhakaClock(doc.endAt),

    status,
    state: eventStateFor({ status, startAt: doc.startAt, endAt: doc.endAt }, now),
    instructions: isRoutine ? '' : (doc.instructions || ''),
    templateId: isRoutine && doc.template ? String(doc.template) : null,
    // Which fields this date was individually changed on. Empty means it is a
    // pure copy of the routine, so a client can tell "changed for this date"
    // apart from "as the routine says" without a second lookup.
    overriddenFields: isRoutine ? (doc.overriddenFields || []) : [],
  };
}

function windowFilter(from, to) {
  const filter = {};
  if (from) filter.startAt = { ...(filter.startAt || {}), $gte: from };
  if (to) filter.startAt = { ...(filter.startAt || {}), $lt: to };
  return filter;
}

/**
 * Every entry visible to `user` between two instants, merged and sorted by
 * start. Pass no window for everything the user can see.
 *
 * `now` is threaded through rather than read from the clock inside the
 * per-entry mapper, so a caller asking about a specific instant (the reminder
 * engine, the widget's tests) gets states computed against that instant rather
 * than against whatever the wall clock says.
 */
export async function resolveVisibleEvents(user, { from = null, to = null, now = new Date() } = {}) {
  const audience = await audienceFilterFor(user);
  if (audience) {
    // A filter that can never match ("_id: null") is how an unplaced account is
    // kept empty without a second code path.
    if (audience._id === null) return [];
  }

  const query = { ...(audience || {}), ...windowFilter(from, to) };

  const [instances, events] = await Promise.all([
    ScheduleInstance.find(query).populate(POPULATE).sort({ startAt: 1 }).lean(),
    AcademicEvent.find(query).populate(POPULATE).sort({ startAt: 1 }).lean(),
  ]);

  return [
    ...instances.map((doc) => toView(doc, 'ROUTINE', now)),
    ...events.map((doc) => toView(doc, 'EVENT', now)),
  ].sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
}

/** The Dhaka day containing `now`. */
export function getTodayEvents(user, now = new Date()) {
  return resolveVisibleEvents(user, { from: startOfDhakaDay(now), to: endOfDhakaDay(now), now });
}

/** The Dhaka week (Sunday–Saturday) containing `now`. */
export function getWeekEvents(user, now = new Date()) {
  const dayStart = startOfDhakaDay(now);
  const dayOffset = weekdayOf(dhakaDateString(now));
  const from = new Date(dayStart.getTime() - dayOffset * MS_PER_DAY);
  return resolveVisibleEvents(user, { from, to: new Date(from.getTime() + 7 * MS_PER_DAY), now });
}

/** The Dhaka calendar month containing `now` (or the month named by `month`). */
export function getMonthEvents(user, { now = new Date(), month = null } = {}) {
  const anchor = month && /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : dhakaDateString(now);
  const year = Number(anchor.slice(0, 4));
  const monthNumber = Number(anchor.slice(5, 7));

  const from = combineDhakaDateTime(`${anchor.slice(0, 8)}01`, '00:00');
  const nextMonth = monthNumber === 12 ? `${year + 1}-01-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}-01`;
  const to = combineDhakaDateTime(nextMonth, '00:00');

  return resolveVisibleEvents(user, { from, to, now });
}

/**
 * The widget's whole job in one call: what is on now, what is next, and whether
 * this person has any schedule at all.
 *
 * `hasAnySchedule` is what lets a client tell "nothing on today" apart from
 * "your routine hasn't been published yet" (spec §15 of the widget spec) — two
 * states that otherwise look identical.
 */
export async function getCurrentAndNext(user, now = new Date()) {
  const from = startOfDhakaDay(now);
  const to = new Date(now.getTime() + NEXT_LOOKAHEAD_DAYS * MS_PER_DAY);

  const [upcoming, total] = await Promise.all([
    resolveVisibleEvents(user, { from, to, now }),
    countVisible(user),
  ]);

  const at = now.getTime();
  const live = upcoming.filter(
    (event) => event.status !== 'CANCELLED'
      && new Date(event.startAt).getTime() <= at
      && at < new Date(event.endAt).getTime()
  );

  // A cancelled occurrence is never "current" and never "next" — it is skipped
  // entirely so the widget moves straight on to the following one.
  const current = live.length ? live[0] : null;
  const next = upcoming.find(
    (event) => event.status !== 'CANCELLED' && new Date(event.startAt).getTime() > at
  ) || null;

  return {
    serverTime: now,
    timezone: APP_TIMEZONE,
    current,
    next,
    hasAnySchedule: total > 0,
  };
}

/** Whether anything at all is published for this user, ever. */
async function countVisible(user) {
  const audience = await audienceFilterFor(user);
  if (audience && audience._id === null) return 0;
  const query = audience || {};

  const [instances, events] = await Promise.all([
    ScheduleInstance.countDocuments(query),
    AcademicEvent.countDocuments(query),
  ]);
  return instances + events;
}

export default {
  audienceFilterFor,
  resolveVisibleEvents,
  getTodayEvents,
  getWeekEvents,
  getMonthEvents,
  getCurrentAndNext,
};
