import mongoose from 'mongoose';
import RoutineTemplate from '../models/RoutineTemplate.js';
import ScheduleInstance from '../models/ScheduleInstance.js';
import Course from '../models/Course.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { getSettings } from '../models/Settings.js';
import { isSuperAdminTier } from '../models/Role.js';
import { assertFacultyCourseAccess, facultyCourseClause } from '../services/teachingService.js';
import { generateInstancesForTemplate, findConflicts } from '../services/routineService.js';
import { notifyOccurrence } from '../services/routineNotifications.js';
import { resolveFacultyForCourse } from '../services/notifications/recipientResolver.js';
import {
  audienceFilterFor,
  resolveVisibleEvents,
  getTodayEvents,
  getWeekEvents,
  getMonthEvents,
  getCurrentAndNext,
} from '../services/academicEventService.js';
import { resolveGroup, getAcademicGroups } from '../utils/groups.js';
import { CLASS_TYPES, DELIVERY_MODES } from '../utils/academicEventTypes.js';
import { parseAsDhakaTime, isDateOnly, isTimeOnly, combineDhakaDateTime, endOfDhakaDay, formatInAppTimezone } from '../utils/academicSchedule.js';

// Class routine: the recurring rules an administrator/CR/faculty member sets up,
// and the dated occurrences everyone else reads.
//
// Every read goes through academicEventService, which derives the audience from
// the authenticated user's own record — no query parameter here can widen what a
// caller sees (spec §32).

const TEMPLATE_POPULATE = [
  { path: 'course', select: 'name courseId' },
  { path: 'faculty', select: 'name' },
  { path: 'department', select: 'name code' },
  { path: 'batch', select: 'name code' },
  { path: 'semester', select: 'name code' },
];

async function assertRoutineEnabled() {
  const settings = await getSettings();
  if (!settings.routineSystemEnabled) {
    throw new ApiError(400, 'The class routine system is currently disabled', null, 'ROUTINE_DISABLED');
  }
}

/**
 * Who may touch a routine entry for this course.
 *
 * Super Admin and the unrestricted `admin` role may place anything. Everyone
 * else holding a routine permission is additionally held to their assigned
 * scope when they have one — the same rule that already governs uploading
 * material for a course, so a faculty member cannot publish a timetable entry
 * for a course they do not teach.
 */
async function assertScheduleScope(user, courseId) {
  if (isSuperAdminTier(user.role) || user.role === 'admin') return;
  const scoped = (user.assignedCourses?.length || 0) > 0 || (user.assignedDepartments?.length || 0) > 0;
  if (!scoped) return;
  await assertFacultyCourseAccess(user, courseId);
}

/** Validates the audience axes every entry needs and returns them resolved. */
async function resolveAudience(body, user) {
  const { department, batch, semester, course } = body;
  for (const [field, value] of Object.entries({ department, batch, semester, course })) {
    if (!value || !mongoose.isValidObjectId(value)) {
      throw new ApiError(400, `A valid ${field} is required`);
    }
  }

  const courseDoc = await Course.findById(course).select('department name courseId');
  if (!courseDoc) throw new ApiError(400, 'Course not found');

  // The course owns the department: accepting a mismatched pair would create
  // entries no audience query could ever match.
  if (String(courseDoc.department) !== String(department)) {
    throw new ApiError(400, 'The course does not belong to the selected department');
  }

  await assertScheduleScope(user, course);

  return {
    department,
    batch,
    semester,
    course,
    group: await resolveGroup(body.group),
  };
}

function assertClassTypes({ classType, deliveryMode }) {
  if (classType && !CLASS_TYPES.includes(classType)) {
    throw new ApiError(400, `Unknown classType "${classType}"`);
  }
  if (deliveryMode && !DELIVERY_MODES.includes(deliveryMode)) {
    throw new ApiError(400, `Unknown deliveryMode "${deliveryMode}"`);
  }
}

/**
 * Publishing a conflict is a mistake, not a permission — so it is refused
 * unless the caller explicitly overrides. `calendar_manage` is what makes the
 * override meaningful; a caller without it is simply blocked.
 */
async function resolveConflictOutcome(conflicts, body, user) {
  if (!conflicts.length) return [];
  const override = body.allowConflicts === true || body.allowConflicts === 'true';
  if (!override) {
    throw new ApiError(
      409,
      'This slot clashes with an existing class or exam (same room or same faculty member).',
      conflicts,
      'SCHEDULE_CONFLICT'
    );
  }
  return conflicts;
}

// ----- Read -----

/** GET /routine/my — the caller's own schedule, in whichever shape they asked for. */
export const getMyRoutine = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  const view = String(req.query.view || '').toLowerCase();

  if (view === 'today') return respondWith(res, await getTodayEvents(req.user));
  if (view === 'week') return respondWith(res, await getWeekEvents(req.user));
  if (view === 'month') return respondWith(res, await getMonthEvents(req.user, { month: req.query.month }));

  const from = req.query.from ? parseAsDhakaTime(req.query.from) : null;
  const to = req.query.to ? parseAsDhakaTime(req.query.to) : null;
  return respondWith(res, await resolveVisibleEvents(req.user, { from, to }));
});

export const getTodayRoutine = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  respondWith(res, await getTodayEvents(req.user));
});

export const getWeekRoutine = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  respondWith(res, await getWeekEvents(req.user));
});

export const getMonthRoutine = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  respondWith(res, await getMonthEvents(req.user, { month: req.query.month }));
});

/**
 * GET /events/my/current-next — the SmartEventWidget's single call.
 *
 * Returns the live occurrence, the next one, and whether this user has any
 * schedule at all, so the client can tell "nothing on today" apart from
 * "your routine hasn't been published yet". Clients count down locally from
 * `serverTime`/`timezone` rather than polling.
 */
export const getCurrentNext = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  const result = await getCurrentAndNext(req.user);
  res.json({
    success: true,
    data: {
      serverTime: result.serverTime.toISOString(),
      timezone: result.timezone,
      current: result.current,
      next: result.next,
      hasAnySchedule: result.hasAnySchedule,
    },
  });
});

/** GET /routine/instances/:id — one occurrence, still audience-checked. */
export const getInstance = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  const instance = await ScheduleInstance.findById(req.params.id).populate(TEMPLATE_POPULATE);
  if (!instance) throw new ApiError(404, 'Schedule entry not found');

  const audience = await audienceFilterFor(req.user);
  const flat = instance.toObject();
  const visible = !audience || matchesAudience(flat, audience);
  if (!visible) throw new ApiError(403, 'You do not have access to this entry', null, 'FORBIDDEN');

  res.json({ success: true, data: flat });
});

/** The stored audience filter, applied in memory to a single loaded document. */
function matchesAudience(doc, filter) {
  // The audience filter only ever constrains these five fields — see
  // academicEventService.audienceFilterFor.
  if (filter.batch && String(doc.batch) !== String(filter.batch)) return false;
  if (filter.semester && String(doc.semester) !== String(filter.semester)) return false;
  if (filter.faculty && String(doc.faculty) !== String(filter.faculty)) return false;
  if (filter.group?.$in && !filter.group.$in.includes(doc.group)) return false;
  if (filter.$or) {
    const matchesScope = filter.$or.some((clause) => {
      if (clause.department) return String(doc.department) === String(clause.department);
      if (clause.course?.$in) return clause.course.$in.map(String).includes(String(doc.course));
      return false;
    });
    if (!matchesScope) return false;
  }
  return true;
}

/**
 * GET /routine/instances — the dated occurrences for a scope, for the Routine
 * Manager's timetable.
 *
 * The audience endpoints answer "what may this person see"; this one answers
 * "what is on for CSE / Batch 14 / Semester 1 on this date", which is a
 * management question and therefore gated by routine_view and, for anyone with
 * an assigned scope, held to their own courses.
 */
export const listInstances = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  const filter = {};

  const broad = isSuperAdminTier(req.user.role) || req.user.role === 'admin';
  if (!broad) {
    const scoped = await Course.find(facultyCourseClause(req.user)).distinct('_id');
    filter.$or = [
      { course: { $in: scoped } },
      { department: { $in: req.user.assignedDepartments || [] } },
    ];
  }

  for (const axis of ['department', 'batch', 'semester', 'course', 'faculty', 'group']) {
    if (req.query[axis] && mongoose.isValidObjectId(req.query[axis])) filter[axis] = req.query[axis];
  }

  // A single Dhaka day is the common case (the manager shows one date at a
  // time); from/to is there for range views.
  if (req.query.date && isDateOnly(req.query.date)) {
    const dayStart = combineDhakaDateTime(req.query.date, '00:00');
    filter.startAt = { $gte: dayStart, $lt: endOfDhakaDay(dayStart) };
  } else if (req.query.from || req.query.to) {
    filter.startAt = {};
    if (req.query.from) filter.startAt.$gte = parseAsDhakaTime(req.query.from);
    if (req.query.to) filter.startAt.$lt = parseAsDhakaTime(req.query.to);
  }

  const instances = await ScheduleInstance.find(filter)
    .populate(TEMPLATE_POPULATE)
    .sort({ startAt: 1 })
    .limit(300);

  res.json({ success: true, data: instances });
});

/** GET /routine/templates — the recurring rules this caller may manage.
 * `?course=` / `?batch=` narrow it further; the scope clause is what keeps a
 * faculty member to their own courses.
 */
export const listTemplates = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  const filter = { status: 'ACTIVE' };

  const broad = isSuperAdminTier(req.user.role) || req.user.role === 'admin';
  if (!broad) {
    const clause = facultyCourseClause(req.user);
    const scoped = await Course.find(clause).distinct('_id');
    filter.course = { $in: scoped };
  }
  if (req.query.course && mongoose.isValidObjectId(req.query.course)) filter.course = req.query.course;
  if (req.query.batch && mongoose.isValidObjectId(req.query.batch)) filter.batch = req.query.batch;
  if (req.query.semester && mongoose.isValidObjectId(req.query.semester)) filter.semester = req.query.semester;

  const templates = await RoutineTemplate.find(filter).populate(TEMPLATE_POPULATE).sort({ startDate: 1 });
  res.json({ success: true, data: templates });
});

// ----- Write -----

/** POST /routine — a recurring rule, materialised into its dated occurrences. */
export const createRoutine = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  assertClassTypes(req.body);

  const audience = await resolveAudience(req.body, req.user);
  const { days, startDate, endDate, startTime, endTime, faculty, roomNumber, classType, deliveryMode, onlineLink } = req.body;

  if (!isDateOnly(startDate) || !isDateOnly(endDate)) {
    throw new ApiError(400, 'startDate and endDate must be YYYY-MM-DD');
  }
  if (!isTimeOnly(startTime) || !isTimeOnly(endTime)) {
    throw new ApiError(400, 'startTime and endTime must be HH:mm');
  }

  const template = new RoutineTemplate({
    ...audience,
    faculty: faculty || null,
    roomNumber: roomNumber || '',
    days: Array.isArray(days) ? days.map(Number) : [],
    startDate,
    endDate,
    startTime,
    endTime,
    classType: classType || 'REGULAR',
    deliveryMode: deliveryMode || 'OFFLINE',
    onlineLink: onlineLink || '',
    createdBy: req.user._id,
  });
  await template.validate();

  // Conflicts are checked against the occurrences this rule would create, not
  // against the rule — a clash is a property of a specific date and time.
  const startAt = combineDhakaDateTime(startDate, startTime);
  const endAt = combineDhakaDateTime(startDate, endTime);
  const conflicts = await resolveConflictOutcome(
    await findConflicts([{ ...audience, faculty: template.faculty, roomNumber: template.roomNumber, startAt, endAt }]),
    req.body,
    req.user
  );

  await template.save();
  const generated = await generateInstancesForTemplate(template, req.user._id);

  res.status(201).json({
    success: true,
    message: `Routine created — ${generated.created} class date(s) scheduled`,
    data: { template: await template.populate(TEMPLATE_POPULATE), generated },
    ...(conflicts.length ? { warnings: conflicts } : {}),
  });
});

/** PATCH /routine/templates/:id — edit the rule and bring future dates into line. */
export const updateTemplate = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  assertClassTypes(req.body);

  const template = await RoutineTemplate.findById(req.params.id);
  if (!template) throw new ApiError(404, 'Routine not found');
  await assertScheduleScope(req.user, template.course);

  const editable = ['days', 'startDate', 'endDate', 'startTime', 'endTime', 'classType', 'deliveryMode', 'onlineLink', 'roomNumber', 'faculty', 'status'];
  for (const key of editable) {
    if (req.body[key] !== undefined) template[key] = req.body[key];
  }
  if (req.body.group !== undefined) template.group = await resolveGroup(req.body.group);
  template.updatedBy = req.user._id;
  await template.validate();
  await template.save();

  // Existing occurrences are the exception record and are never rewritten —
  // only dates that have no occurrence yet are added, so a cancelled or moved
  // date survives an edit to the rule.
  const generated = await generateInstancesForTemplate(template, req.user._id);

  res.json({
    success: true,
    message: 'Routine updated',
    data: { template: await template.populate(TEMPLATE_POPULATE), generated },
  });
});

/** DELETE /routine/templates/:id — retire a rule and its future occurrences. */
export const deleteTemplate = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  const template = await RoutineTemplate.findById(req.params.id);
  if (!template) throw new ApiError(404, 'Routine not found');
  await assertScheduleScope(req.user, template.course);

  template.status = 'ARCHIVED';
  template.updatedBy = req.user._id;
  await template.save();

  // Past dates stay: a student's history of attended classes should not vanish
  // because the rule behind it was retired.
  const removed = await ScheduleInstance.deleteMany({
    template: template._id,
    startAt: { $gte: new Date() },
  });

  res.json({ success: true, message: 'Routine retired', data: { removedFutureOccurrences: removed.deletedCount } });
});

/** PATCH /routine/instances/:id — edit one date (room, group, faculty, times). */
export const updateInstance = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  assertClassTypes(req.body);

  const instance = await ScheduleInstance.findById(req.params.id).populate(TEMPLATE_POPULATE);
  if (!instance) throw new ApiError(404, 'Schedule entry not found');
  await assertScheduleScope(req.user, instance.course._id || instance.course);

  const previousRoom = instance.roomNumber;
  for (const key of ['roomNumber', 'faculty', 'classType', 'deliveryMode', 'onlineLink', 'note', 'status']) {
    if (req.body[key] !== undefined) instance[key] = req.body[key];
  }
  if (req.body.group !== undefined) instance.group = await resolveGroup(req.body.group);

  if (req.body.startTime !== undefined || req.body.endTime !== undefined) {
    instance.startTime = req.body.startTime ?? instance.startTime;
    instance.endTime = req.body.endTime ?? instance.endTime;
  }
  if (req.body.date !== undefined) instance.date = req.body.date;

  instance.updatedBy = req.user._id;
  await instance.validate();

  const conflicts = await resolveConflictOutcome(
    await findConflicts([instance.toObject()], { excludeIds: [instance._id] }),
    req.body,
    req.user
  );

  await instance.save();

  // A moved room is its own notification — it is the change students most often
  // miss, and the spec calls it out separately.
  if (previousRoom && instance.roomNumber && previousRoom !== instance.roomNumber) {
    await notifyOccurrence(instance, 'CLASS_ROOM_CHANGED', {
      actorId: req.user._id,
      extraVars: { fromRoom: previousRoom, toRoom: instance.roomNumber, when: formatInAppTimezone(instance.startAt) },
    });
  }

  res.json({
    success: true,
    message: 'Schedule entry updated',
    data: instance,
    ...(conflicts.length ? { warnings: conflicts } : {}),
  });
});

/** POST /routine/instances/:id/cancel — one date only; the series is untouched. */
export const cancelInstance = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  const instance = await ScheduleInstance.findById(req.params.id).populate(TEMPLATE_POPULATE);
  if (!instance) throw new ApiError(404, 'Schedule entry not found');
  await assertScheduleScope(req.user, instance.course._id || instance.course);

  if (instance.status !== 'CANCELLED') {
    instance.status = 'CANCELLED';
    if (req.body?.note) instance.note = req.body.note;
    instance.updatedBy = req.user._id;
    await instance.save();
    await notifyOccurrence(instance, 'CLASS_CANCELLED', {
      actorId: req.user._id,
      extraVars: { when: formatInAppTimezone(instance.startAt) },
    });
  }

  res.json({ success: true, message: 'Class cancelled', data: instance });
});

/**
 * POST /routine/instances/:id/reschedule — move one date.
 * The original window is kept on the document so the calendar can show that the
 * class was moved rather than silently rewriting history.
 */
export const rescheduleInstance = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  const instance = await ScheduleInstance.findById(req.params.id).populate(TEMPLATE_POPULATE);
  if (!instance) throw new ApiError(404, 'Schedule entry not found');
  await assertScheduleScope(req.user, instance.course._id || instance.course);

  const { date, startTime, endTime, roomNumber } = req.body || {};
  if (!isDateOnly(date) || !isTimeOnly(startTime) || !isTimeOnly(endTime)) {
    throw new ApiError(400, 'date (YYYY-MM-DD), startTime and endTime (HH:mm) are required');
  }

  instance.originalStartAt = instance.originalStartAt || instance.startAt;
  instance.originalStartTime = instance.originalStartTime || instance.startTime;
  instance.originalRoomNumber = instance.originalRoomNumber || instance.roomNumber;

  instance.date = date;
  instance.startTime = startTime;
  instance.endTime = endTime;
  if (roomNumber) instance.roomNumber = roomNumber;
  instance.status = 'RESCHEDULED';
  instance.updatedBy = req.user._id;
  await instance.validate();

  const conflicts = await resolveConflictOutcome(
    await findConflicts([instance.toObject()], { excludeIds: [instance._id] }),
    req.body,
    req.user
  );

  await instance.save();
  await notifyOccurrence(instance, 'CLASS_RESCHEDULED', {
    actorId: req.user._id,
    extraVars: { when: formatInAppTimezone(instance.startAt) },
  });

  res.json({
    success: true,
    message: 'Class rescheduled',
    data: instance,
    ...(conflicts.length ? { warnings: conflicts } : {}),
  });
});

/** DELETE /routine/instances/:id — remove a single date entirely. */
export const deleteInstance = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  const instance = await ScheduleInstance.findById(req.params.id);
  if (!instance) throw new ApiError(404, 'Schedule entry not found');
  await assertScheduleScope(req.user, instance.course);
  await instance.deleteOne();
  res.json({ success: true, message: 'Schedule entry deleted' });
});

function respondWith(res, events) {
  res.json({ success: true, data: events });
}

/**
 * GET /routine/groups — the configured academic groups (BOTH, A1, A2, ...).
 *
 * Its own endpoint rather than a field on GET /auth/settings: that response is
 * a flat map of booleans, and the Android client deserialises it as exactly
 * that — adding an array there would fail the whole settings parse and take
 * every feature flag down with it.
 */
export const getGroups = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { groups: await getAcademicGroups() } });
});

/**
 * GET /routine/faculty?course=<id> — who teaches this course, so the routine
 * form can preselect them instead of asking again (spec §3, §42: a faculty
 * member is inferred from the course, and only changed deliberately).
 */
export const getFacultyForCourse = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  const { course } = req.query;
  if (!course || !mongoose.isValidObjectId(course)) {
    throw new ApiError(400, 'A valid course is required');
  }
  await assertScheduleScope(req.user, course);

  const ids = await resolveFacultyForCourse(course);
  const faculty = await User.find({ _id: { $in: ids } })
    .select('name email')
    .sort({ name: 1 });

  res.json({ success: true, data: faculty });
});
