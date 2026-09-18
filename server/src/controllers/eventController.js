import mongoose from 'mongoose';
import AcademicEvent from '../models/AcademicEvent.js';
import Course from '../models/Course.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { getSettings } from '../models/Settings.js';
import { isSuperAdminTier } from '../models/Role.js';
import { assertFacultyCourseAccess, facultyCourseClause } from '../services/teachingService.js';
import { findConflicts } from '../services/routineService.js';
import { notifyOccurrence } from '../services/routineNotifications.js';
import { resolveVisibleEvents } from '../services/academicEventService.js';
import { resolveGroup } from '../utils/groups.js';
import { CLASS_TYPES, EVENT_TYPES, DELIVERY_MODES } from '../utils/academicEventTypes.js';
import { parseAsDhakaTime, isDateOnly, isTimeOnly, formatInAppTimezone } from '../utils/academicSchedule.js';

// Exams and academic events — the one-off half of the calendar: a CT, a
// mid-term, a final, a quiz, an assignment deadline or a general event.
//
// Reads go through academicEventService so the calendar, the widget and the
// reminder engine all resolve the same audience; writes are gated by the
// exam_* permissions plus the caller's course scope.

const POPULATE = [
  { path: 'course', select: 'name courseId' },
  { path: 'faculty', select: 'name' },
  { path: 'department', select: 'name code' },
  { path: 'batch', select: 'name code' },
  { path: 'semester', select: 'name code' },
];

/** CT/Mid/Final/Quiz are course-bound; a general event need not be. */
const COURSE_REQUIRED_TYPES = new Set(['CT', 'MID_TERM', 'FINAL', 'QUIZ']);

async function assertRoutineEnabled() {
  const settings = await getSettings();
  if (!settings.routineSystemEnabled) {
    throw new ApiError(400, 'The class routine system is currently disabled', null, 'ROUTINE_DISABLED');
  }
}

async function assertEventScope(user, event) {
  if (isSuperAdminTier(user.role) || user.role === 'admin') return;
  const scoped = (user.assignedCourses?.length || 0) > 0 || (user.assignedDepartments?.length || 0) > 0;
  if (!scoped) return;
  if (event.course) {
    await assertFacultyCourseAccess(user, event.course._id || event.course);
    return;
  }
  const inScope = (user.assignedDepartments || []).map(String).includes(String(event.department));
  if (!inScope) throw new ApiError(403, 'You do not have access to this event', null, 'FORBIDDEN');
}

function assertTypes({ classType, eventType, deliveryMode }) {
  if (classType && !CLASS_TYPES.includes(classType)) throw new ApiError(400, `Unknown classType "${classType}"`);
  if (eventType && !EVENT_TYPES.includes(eventType)) throw new ApiError(400, `Unknown eventType "${eventType}"`);
  if (deliveryMode && !DELIVERY_MODES.includes(deliveryMode)) throw new ApiError(400, `Unknown deliveryMode "${deliveryMode}"`);
}

/** Validates + normalises the audience axes and the time window for a write. */
async function resolveEventInput(body, user) {
  const { department, batch, semester, course, date, startTime, endTime, classType } = body;

  for (const [field, value] of Object.entries({ department, batch, semester })) {
    if (!value || !mongoose.isValidObjectId(value)) throw new ApiError(400, `A valid ${field} is required`);
  }
  if (COURSE_REQUIRED_TYPES.has(classType) && !course) {
    throw new ApiError(400, `A course is required for a ${classType} exam`);
  }
  if (course) {
    if (!mongoose.isValidObjectId(course)) throw new ApiError(400, 'A valid course is required');
    const courseDoc = await Course.findById(course).select('department');
    if (!courseDoc) throw new ApiError(400, 'Course not found');
    if (String(courseDoc.department) !== String(department)) {
      throw new ApiError(400, 'The course does not belong to the selected department');
    }
  }
  await assertEventScopeForInput(user, { course, department });

  if (!isDateOnly(date)) throw new ApiError(400, 'date must be YYYY-MM-DD');
  if (!isTimeOnly(startTime) || !isTimeOnly(endTime)) throw new ApiError(400, 'startTime and endTime must be HH:mm');

  return { department, batch, semester, course: course || null, group: await resolveGroup(body.group) };
}

async function assertEventScopeForInput(user, { course, department }) {
  if (isSuperAdminTier(user.role) || user.role === 'admin') return;
  const scoped = (user.assignedCourses?.length || 0) > 0 || (user.assignedDepartments?.length || 0) > 0;
  if (!scoped) return;
  if (course) return assertFacultyCourseAccess(user, course);
  const inScope = (user.assignedDepartments || []).map(String).includes(String(department));
  if (!inScope) throw new ApiError(403, 'You do not have access to this department', null, 'FORBIDDEN');
}

async function resolveConflictOutcome(conflicts, body) {
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

/** GET /calendar/my — the caller's own calendar (classes, exams, events, deadlines). */
export const getMyCalendar = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  const from = req.query.from ? parseAsDhakaTime(req.query.from) : null;
  const to = req.query.to ? parseAsDhakaTime(req.query.to) : null;

  const events = await resolveVisibleEvents(req.user, { from, to });
  const type = String(req.query.type || '').toUpperCase();
  const filtered = EVENT_TYPES.includes(type) ? events.filter((e) => e.eventType === type) : events;

  res.json({ success: true, data: filtered });
});

/** GET /exams/my — the assessment half only. */
export const getMyExams = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  const from = req.query.from ? parseAsDhakaTime(req.query.from) : null;
  const to = req.query.to ? parseAsDhakaTime(req.query.to) : null;

  const events = await resolveVisibleEvents(req.user, { from, to });
  res.json({ success: true, data: events.filter((e) => e.eventType === 'EXAM' || e.eventType === 'DEADLINE') });
});

/**
 * GET /calendar/events — the management list. An unrestricted viewer sees
 * everything and may narrow by the audience axes; a scoped faculty member sees
 * only the courses they are assigned to.
 */
export const listEvents = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  const filter = {};

  const broad = isSuperAdminTier(req.user.role) || req.user.role === 'admin';
  if (!broad) {
    const scopedCourses = await Course.find(facultyCourseClause(req.user)).distinct('_id');
    filter.$or = [
      { course: { $in: scopedCourses } },
      { department: { $in: req.user.assignedDepartments || [] } },
    ];
  }
  for (const axis of ['department', 'batch', 'semester', 'course', 'faculty', 'group']) {
    if (req.query[axis] && mongoose.isValidObjectId(req.query[axis])) filter[axis] = req.query[axis];
  }
  if (req.query.eventType) filter.eventType = String(req.query.eventType).toUpperCase();
  if (req.query.from || req.query.to) {
    filter.startAt = {};
    if (req.query.from) filter.startAt.$gte = parseAsDhakaTime(req.query.from);
    if (req.query.to) filter.startAt.$lt = parseAsDhakaTime(req.query.to);
  }

  const events = await AcademicEvent.find(filter).populate(POPULATE).sort({ startAt: 1 });
  res.json({ success: true, data: events });
});

// ----- Write -----

/** POST /calendar/events (and POST /exams) — schedule a CT/mid-term/final/quiz/deadline/event. */
export const createEvent = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  assertTypes(req.body);

  const audience = await resolveEventInput(req.body, req.user);
  const { title, classType, faculty, roomNumber, deliveryMode, onlineLink, instructions, date, startTime, endTime } = req.body;
  if (!title || !String(title).trim()) throw new ApiError(400, 'A title is required');

  const event = new AcademicEvent({
    ...audience,
    title: String(title).trim(),
    classType: classType || 'OTHER',
    faculty: faculty || null,
    roomNumber: roomNumber || '',
    deliveryMode: deliveryMode || 'OFFLINE',
    onlineLink: onlineLink || '',
    instructions: instructions || '',
    date,
    startTime,
    endTime,
    createdBy: req.user._id,
  });
  await event.validate();

  const conflicts = await resolveConflictOutcome(
    await findConflicts([event.toObject()]),
    req.body
  );

  await event.save();
  await event.populate(POPULATE);

  // Matching students are told as soon as it exists — the spec's exam
  // notification, delivered in-app on the web and as a push on Android.
  await notifyOccurrence(event, 'EXAM_CREATED', { actorId: req.user._id });

  res.status(201).json({
    success: true,
    message: 'Event scheduled',
    data: event,
    ...(conflicts.length ? { warnings: conflicts } : {}),
  });
});

export const updateEvent = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  assertTypes(req.body);

  const event = await AcademicEvent.findById(req.params.id);
  if (!event) throw new ApiError(404, 'Event not found');
  await assertEventScope(req.user, event);

  for (const key of ['title', 'classType', 'faculty', 'roomNumber', 'deliveryMode', 'onlineLink', 'instructions', 'status']) {
    if (req.body[key] !== undefined) event[key] = req.body[key];
  }
  if (req.body.group !== undefined) event.group = await resolveGroup(req.body.group);
  if (req.body.date !== undefined) event.date = req.body.date;
  if (req.body.startTime !== undefined) event.startTime = req.body.startTime;
  if (req.body.endTime !== undefined) event.endTime = req.body.endTime;

  event.updatedBy = req.user._id;
  await event.validate();

  const conflicts = await resolveConflictOutcome(
    await findConflicts([event.toObject()], { excludeIds: [event._id] }),
    req.body
  );

  await event.save();
  await event.populate(POPULATE);

  if (req.body.status === 'CANCELLED') {
    await notifyOccurrence(event, 'CLASS_CANCELLED', {
      actorId: req.user._id,
      extraVars: { when: formatInAppTimezone(event.startAt) },
    });
  } else {
    await notifyOccurrence(event, 'EXAM_UPDATED', {
      actorId: req.user._id,
      extraVars: { startAt: formatInAppTimezone(event.startAt) },
    });
  }

  res.json({
    success: true,
    message: 'Event updated',
    data: event,
    ...(conflicts.length ? { warnings: conflicts } : {}),
  });
});

export const deleteEvent = asyncHandler(async (req, res) => {
  await assertRoutineEnabled();
  const event = await AcademicEvent.findById(req.params.id);
  if (!event) throw new ApiError(404, 'Event not found');
  await assertEventScope(req.user, event);
  await event.deleteOne();
  res.json({ success: true, message: 'Event deleted' });
});
