import CourseEnrollment, { STUDENT_REQUESTABLE_TYPES, ACCESS_GRANTING_STATUSES } from '../models/CourseEnrollment.js';
import Course from '../models/Course.js';
import User from '../models/User.js';
import Semester from '../models/Semester.js';
import Batch from '../models/Batch.js';
import { getSettings } from '../models/Settings.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { parsePagination } from '../utils/pagination.js';
import { sendEmail } from '../services/email/emailService.js';
import { enrollmentApprovedEmail, enrollmentRejectedEmail, enrollmentRequestedEmail } from '../services/email/templates.js';
import { emit } from '../services/notifications/notificationService.js';
import { resolveSingleUser, resolveFacultyForCourse } from '../services/notifications/recipientResolver.js';

const POPULATE = [
  { path: 'course', select: 'name courseId department semester', populate: { path: 'department', select: 'name code' } },
  { path: 'semester', select: 'name code' },
  { path: 'batch', select: 'name code' },
  { path: 'student', select: 'name email rollNo department batch semester' },
  { path: 'approvedBy', select: 'name role' },
];

// Maps each additional enrollment type to its Settings feature-flag key —
// single source of truth so the "is this type currently allowed" check
// never drifts between the request endpoint and anywhere else.
const TYPE_FLAG = {
  retake: 'allowRetakeEnrollment',
  extra: 'allowExtraEnrollment',
  backlog: 'allowBacklogEnrollment',
  improvement: 'allowImprovementEnrollment',
  advance: 'allowAdvanceEnrollment',
};

async function assertEnrollmentSystemEnabled() {
  const settings = await getSettings();
  if (!settings.courseEnrollmentSystemEnabled) {
    throw new ApiError(400, 'The course enrollment system is currently disabled');
  }
  return settings;
}

function assertTypeAllowed(type, settings) {
  const flagKey = TYPE_FLAG[type];
  if (flagKey && !settings[flagKey]) {
    throw new ApiError(403, `${type[0].toUpperCase()}${type.slice(1)} enrollment is currently disabled`, null, 'FORBIDDEN');
  }
}

function isUnrestrictedStaff(user) {
  return user.role === 'admin' || user.role === 'super_admin' || user.role === 'administrator';
}

// Faculty, and any other admin-tier role (e.g. "CR"), are scoped to their
// assigned Department(s)/Course(s) — identical pattern to reviewController's
// scopeFilter/assertReviewAccess.
async function resolveScopedCourseIds(user) {
  const deptIds = user.assignedDepartments || [];
  const courseIds = (user.assignedCourses || []).map(String);
  const deptCourseIds = deptIds.length ? await Course.find({ department: { $in: deptIds } }).distinct('_id') : [];
  return [...new Set([...courseIds, ...deptCourseIds.map(String)])];
}

async function scopeFilter(user) {
  if (isUnrestrictedStaff(user)) return {};
  const courseIds = await resolveScopedCourseIds(user);
  return { course: { $in: courseIds } };
}

async function assertStaffAccessToEnrollment(enrollment, user) {
  if (isUnrestrictedStaff(user)) return;
  const courseIds = await resolveScopedCourseIds(user);
  if (!courseIds.includes(String(enrollment.course))) {
    throw new ApiError(403, 'This enrollment is outside your assigned Department/Course', null, 'FORBIDDEN');
  }
}

function pushHistory(enrollment, { action, performedBy, previousStatus, newStatus, reason }) {
  enrollment.history.push({ action, performedBy, previousStatus, newStatus: newStatus || enrollment.status, reason: reason || '' });
}

async function notifyStudent(enrollment, kind, reason) {
  const [student, course] = await Promise.all([User.findById(enrollment.student), Course.findById(enrollment.course)]);
  if (!student || !course) return;
  const { subject, html, text } =
    kind === 'approved'
      ? enrollmentApprovedEmail(course.name, course.courseId, enrollment.enrollmentType)
      : enrollmentRejectedEmail(course.name, course.courseId, enrollment.enrollmentType, reason);
  await sendEmail({ to: student.email, subject, html, text }).catch(() => {});

  if (kind === 'approved') {
    emit({
      type: 'JOIN_REQUEST_APPROVED',
      actorId: enrollment.approvedBy,
      entityType: 'COURSE_ENROLLMENT',
      entityId: enrollment._id,
      vars: { courseName: course.name, courseId: course._id },
      recipients: resolveSingleUser(student._id),
    }).catch((err) => console.error('[notify] enrollment approved', err));
  }
}

/**
 * Tells a student they are now enrolled. This is the staff-initiated path —
 * direct and bulk enrollment create an active row with no request and no
 * approval step, so neither JOIN_REQUEST nor JOIN_REQUEST_APPROVED applies and
 * nothing used to be sent at all.
 */
function notifyEnrolled(student, course, enrollmentId, actorId) {
  emit({
    type: 'COURSE_ENROLLED',
    actorId,
    entityType: 'COURSE_ENROLLMENT',
    entityId: enrollmentId,
    vars: { courseName: course.name, courseId: course._id },
    recipients: resolveSingleUser(student._id),
  }).catch((err) => console.error('[notify] course enrolled', err));
}

function isDuplicateKeyError(err) {
  return err && err.code === 11000;
}

const OPEN_STATUSES = ['pending', 'approved', 'active'];

// 0 = unlimited (the schema default) for every one of these — Super Admin
// opts into a cap by setting a positive number on the Permissions/Settings
// page; nothing is capped out of the box.
async function assertWithinLimits(user, enrollmentType, academicYear, semesterId, settings) {
  if (settings.maxAdditionalCoursesPerSemester > 0) {
    const count = await CourseEnrollment.countDocuments({
      student: user._id,
      enrollmentType: { $ne: 'regular' },
      status: { $in: OPEN_STATUSES },
      academicYear,
      semester: semesterId,
    });
    if (count >= settings.maxAdditionalCoursesPerSemester) {
      throw new ApiError(
        409,
        `You already have ${count} additional course(s) open for this academic year/semester — the maximum is ${settings.maxAdditionalCoursesPerSemester}`
      );
    }
  }

  const perTypeLimit = { retake: settings.maxRetakeCourses, extra: settings.maxExtraCourses }[enrollmentType];
  if (perTypeLimit > 0) {
    const count = await CourseEnrollment.countDocuments({ student: user._id, enrollmentType, status: { $in: OPEN_STATUSES } });
    if (count >= perTypeLimit) {
      throw new ApiError(409, `You already have ${count} open ${enrollmentType} enrollment(s) — the maximum is ${perTypeLimit}`);
    }
  }
}

// Notifies Faculty assigned to the course (directly, or via its department)
// that a new request needs review — Admin/Super Admin already see it in
// their queue without an email, same as every other approval flow here.
async function notifyStaffOfRequest(enrollment, course, student) {
  const faculty = await User.find({
    role: 'faculty',
    $or: [{ assignedCourses: course._id }, { assignedDepartments: course.department }],
  }).select('email');
  if (!faculty.length) return;
  const { subject, html, text } = enrollmentRequestedEmail(student.name, course.name, course.courseId, enrollment.enrollmentType);
  await Promise.all(faculty.map((f) => sendEmail({ to: f.email, subject, html, text }).catch(() => {})));

  emit({
    type: 'JOIN_REQUEST',
    actorId: student._id,
    entityType: 'COURSE_ENROLLMENT',
    entityId: enrollment._id,
    vars: { studentName: student.name, courseName: course.name },
    recipients: await resolveFacultyForCourse(course),
  }).catch((err) => console.error('[notify] enrollment request', err));
}

// ----- Student-facing -----

// POST /course-enrollments/request
export const requestEnrollment = asyncHandler(async (req, res) => {
  const settings = await assertEnrollmentSystemEnabled();
  const { courseId, enrollmentType, academicYear, semesterId, reason } = req.body;

  if (!STUDENT_REQUESTABLE_TYPES.includes(enrollmentType)) {
    throw new ApiError(400, `enrollmentType must be one of: ${STUDENT_REQUESTABLE_TYPES.join(', ')}`);
  }
  assertTypeAllowed(enrollmentType, settings);
  if (!courseId || !academicYear || !semesterId) {
    throw new ApiError(400, 'courseId, academicYear, and semesterId are required');
  }
  if (!reason || !reason.trim()) {
    throw new ApiError(400, 'A reason is required for an additional-course request');
  }

  const [course, semester] = await Promise.all([Course.findById(courseId), Semester.findById(semesterId)]);
  if (!course) throw new ApiError(400, 'Invalid course');
  if (!semester) throw new ApiError(400, 'Invalid semester');

  await assertWithinLimits(req.user, enrollmentType, academicYear, semester._id, settings);

  try {
    // student/status are never taken from the request body — always derived
    // from the authenticated user and the fixed 'pending' starting state.
    const enrollment = await CourseEnrollment.create({
      student: req.user._id,
      course: course._id,
      enrollmentType,
      status: 'pending',
      academicYear,
      semester: semester._id,
      batch: req.user.batch || null,
      reason: reason.trim(),
      history: [{ action: 'requested', performedBy: req.user._id, previousStatus: null, newStatus: 'pending', reason: reason.trim() }],
    });
    await enrollment.populate(POPULATE);
    await notifyStaffOfRequest(enrollment, course, req.user);
    res.status(201).json({ success: true, message: 'Enrollment request submitted', data: enrollment });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new ApiError(409, 'You already have an open request or enrollment for this course');
    }
    throw err;
  }
});

// A student's 'regular' courses are the ones their own department teaches —
// courseAccessService.getEffectiveCourseIds already treats every department
// course as reachable. No CourseEnrollment row is written for them (that
// collection is for the explicit retake/extra/backlog/... grants plus the
// administrative bulk-regular seeding tool), so without this the "My Courses"
// screen reports an empty list to a student who can actually open all 50 of
// their department's courses. These rows are synthesized, never persisted.
function currentAcademicYear() {
  const year = new Date().getFullYear();
  return `${year}-${year + 1}`;
}

// Exported for the enrollment test suite (same convention as fileController's
// assertUploadScope).
export async function derivedRegularEnrollments(user) {
  if (!user.department) return [];

  const [courses, allStoredCourseIds, semester, batch] = await Promise.all([
    Course.find({ department: user.department, status: 'active' })
      .populate({ path: 'department', select: 'name code' }),
    CourseEnrollment.find({ student: user._id }).distinct('course'),
    user.semester ? Semester.findById(user.semester).select('name code') : null,
    user.batch ? Batch.findById(user.batch).select('name code') : null,
  ]);

  // Any stored row for a course wins, whatever its status — a dropped or
  // completed enrollment is exactly the case where the derived "you are
  // enrolled" reading would be wrong.
  const claimed = new Set(allStoredCourseIds.map(String));

  return courses
    .filter((course) => !claimed.has(String(course._id)))
    .map((course) => ({
      _id: `regular-${course._id}`,
      student: user._id,
      course,
      enrollmentType: 'regular',
      status: 'active',
      academicYear: currentAcademicYear(),
      semester: semester || null,
      batch: batch || null,
      reason: '',
      // Deliberately no registeredAt: nobody requested this, and a client that
      // prints "Requested <date>" from it would be stating something untrue.
      // `derived` is what tells a client this row is read-only — it has no
      // history and cannot be approved/dropped/deleted, because no record
      // stands behind it.
      derived: true,
      history: [],
    }));
}

// Mirrors the Mongo status clause the stored query ran with, so '/my',
// '/my/active' and '/my/pending' each get the derived rows that belong to them
// (an active derived course is not a pending request).
function matchesStatusFilter(status, filter) {
  const clause = filter.status;
  if (!clause) return true;
  if (typeof clause === 'string') return clause === status;
  return Array.isArray(clause.$in) ? clause.$in.includes(status) : true;
}

async function listMine(req, res, extraFilter) {
  const enrollments = await CourseEnrollment.find({ student: req.user._id, ...extraFilter })
    .populate(POPULATE)
    .sort({ createdAt: -1 });

  // Real records lead; the derived department courses follow them.
  const derived = (await derivedRegularEnrollments(req.user))
    .filter((row) => matchesStatusFilter(row.status, extraFilter));

  res.json({ success: true, data: [...enrollments, ...derived] });
}

export const listMyEnrollments = asyncHandler((req, res) => listMine(req, res, {}));
export const listMyActiveEnrollments = asyncHandler((req, res) => listMine(req, res, { status: { $in: ACCESS_GRANTING_STATUSES } }));
export const listMyPendingEnrollments = asyncHandler((req, res) => listMine(req, res, { status: 'pending' }));

// ----- Staff (Faculty scoped / Admin-tier with 'enrollments' permission / Super Admin unrestricted) -----

// GET /course-enrollments
export const listEnrollments = asyncHandler(async (req, res) => {
  const { status, enrollmentType, course, batch, semester, student } = req.query;
  const { page, limit, skip } = parsePagination(req.query);

  const filter = await scopeFilter(req.user);
  if (status) filter.status = status;
  if (enrollmentType) filter.enrollmentType = enrollmentType;
  if (course) filter.course = course;
  if (batch) filter.batch = batch;
  if (semester) filter.semester = semester;
  if (student) filter.student = student;

  const [enrollments, total] = await Promise.all([
    CourseEnrollment.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    CourseEnrollment.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: enrollments,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// GET /course-enrollments/summary — per-course breakdown by enrollment type,
// scoped exactly like the list endpoint (Faculty/CR see only their own
// courses; Admin/Super Admin see everything, optionally narrowed by the
// same department/batch/semester query params as the list endpoint).
// Counts only currently-enrolled statuses (active/approved) — a pending
// request or a rejected/dropped/completed one isn't part of a "how many
// students are in this course right now" roster.
export const getEnrollmentSummary = asyncHandler(async (req, res) => {
  const { department, batch, semester } = req.query;
  const filter = await scopeFilter(req.user);
  filter.status = { $in: ACCESS_GRANTING_STATUSES };
  if (batch) filter.batch = batch;
  if (semester) filter.semester = semester;

  if (department) {
    const deptCourseIds = await Course.find({ department }).distinct('_id');
    const deptCourseIdSet = new Set(deptCourseIds.map(String));
    filter.course = filter.course?.$in
      ? { $in: filter.course.$in.filter((id) => deptCourseIdSet.has(String(id))) }
      : { $in: deptCourseIds };
  }

  const rows = await CourseEnrollment.aggregate([
    { $match: filter },
    { $group: { _id: { course: '$course', type: '$enrollmentType' }, count: { $sum: 1 } } },
  ]);

  const byCourse = new Map();
  for (const row of rows) {
    const courseId = String(row._id.course);
    if (!byCourse.has(courseId)) byCourse.set(courseId, { courseId, counts: {}, total: 0 });
    const entry = byCourse.get(courseId);
    entry.counts[row._id.type] = row.count;
    entry.total += row.count;
  }

  const courses = await Course.find({ _id: { $in: [...byCourse.keys()] } }).populate('department', 'name code');
  const courseMap = new Map(courses.map((c) => [String(c._id), c]));
  const data = [...byCourse.values()]
    .map((e) => ({ course: courseMap.get(e.courseId), counts: e.counts, total: e.total }))
    .filter((e) => e.course)
    .sort((a, b) => a.course.name.localeCompare(b.course.name));

  res.json({ success: true, data });
});

// GET /course-enrollments/:id
export const getEnrollment = asyncHandler(async (req, res) => {
  const enrollment = await CourseEnrollment.findById(req.params.id).populate(POPULATE);
  if (!enrollment) throw new ApiError(404, 'Enrollment not found');
  await assertStaffAccessToEnrollment(enrollment, req.user);
  res.json({ success: true, data: enrollment });
});

// PATCH /course-enrollments/:id/approve
export const approveEnrollment = asyncHandler(async (req, res) => {
  const enrollment = await CourseEnrollment.findById(req.params.id);
  if (!enrollment) throw new ApiError(404, 'Enrollment not found');
  await assertStaffAccessToEnrollment(enrollment, req.user);
  if (enrollment.status !== 'pending') throw new ApiError(409, 'Only a pending enrollment can be approved');

  const previousStatus = enrollment.status;
  enrollment.status = 'approved';
  enrollment.approvedBy = req.user._id;
  enrollment.approvedAt = new Date();
  pushHistory(enrollment, { action: 'approved', performedBy: req.user._id, previousStatus, newStatus: 'approved' });
  await enrollment.save();
  await notifyStudent(enrollment, 'approved');

  res.json({ success: true, message: 'Enrollment approved', data: enrollment });
});

// PATCH /course-enrollments/:id/reject
export const rejectEnrollment = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const enrollment = await CourseEnrollment.findById(req.params.id);
  if (!enrollment) throw new ApiError(404, 'Enrollment not found');
  await assertStaffAccessToEnrollment(enrollment, req.user);
  if (enrollment.status !== 'pending') throw new ApiError(409, 'Only a pending enrollment can be rejected');

  const previousStatus = enrollment.status;
  enrollment.status = 'rejected';
  pushHistory(enrollment, { action: 'rejected', performedBy: req.user._id, previousStatus, newStatus: 'rejected', reason });
  await enrollment.save();
  await notifyStudent(enrollment, 'rejected', reason);

  res.json({ success: true, message: 'Enrollment rejected', data: enrollment });
});

// PATCH /course-enrollments/:id/activate
export const activateEnrollment = asyncHandler(async (req, res) => {
  const enrollment = await CourseEnrollment.findById(req.params.id);
  if (!enrollment) throw new ApiError(404, 'Enrollment not found');
  await assertStaffAccessToEnrollment(enrollment, req.user);
  if (enrollment.status !== 'approved') throw new ApiError(409, 'Only an approved enrollment can be activated');

  const previousStatus = enrollment.status;
  enrollment.status = 'active';
  pushHistory(enrollment, { action: 'activated', performedBy: req.user._id, previousStatus, newStatus: 'active' });
  await enrollment.save();

  res.json({ success: true, message: 'Enrollment activated', data: enrollment });
});

// PATCH /course-enrollments/:id/complete
export const completeEnrollment = asyncHandler(async (req, res) => {
  const enrollment = await CourseEnrollment.findById(req.params.id);
  if (!enrollment) throw new ApiError(404, 'Enrollment not found');
  await assertStaffAccessToEnrollment(enrollment, req.user);
  if (!['active', 'approved'].includes(enrollment.status)) {
    throw new ApiError(409, 'Only an active or approved enrollment can be completed');
  }

  const previousStatus = enrollment.status;
  enrollment.status = 'completed';
  pushHistory(enrollment, { action: 'completed', performedBy: req.user._id, previousStatus, newStatus: 'completed' });
  await enrollment.save();

  res.json({ success: true, message: 'Enrollment marked completed', data: enrollment });
});

// PATCH /course-enrollments/:id/drop
export const dropEnrollment = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const enrollment = await CourseEnrollment.findById(req.params.id);
  if (!enrollment) throw new ApiError(404, 'Enrollment not found');
  await assertStaffAccessToEnrollment(enrollment, req.user);
  if (!['pending', 'approved', 'active'].includes(enrollment.status)) {
    throw new ApiError(409, 'This enrollment is not open, so it cannot be dropped');
  }

  const previousStatus = enrollment.status;
  enrollment.status = 'dropped';
  pushHistory(enrollment, { action: 'dropped', performedBy: req.user._id, previousStatus, newStatus: 'dropped', reason });
  await enrollment.save();

  res.json({ success: true, message: 'Enrollment dropped', data: enrollment });
});

// POST /course-enrollments — direct-create by staff (any type, immediately
// active). Not exposed to Faculty (route-gated) — matches the spec's split
// where only Admin-tier/Super Admin can "create enrollment directly".
export const createEnrollmentDirect = asyncHandler(async (req, res) => {
  const { studentId, courseId, enrollmentType, academicYear, semesterId, reason } = req.body;
  if (!studentId || !courseId || !enrollmentType || !academicYear || !semesterId) {
    throw new ApiError(400, 'studentId, courseId, enrollmentType, academicYear, and semesterId are required');
  }

  const [student, course, semester] = await Promise.all([
    User.findOne({ _id: studentId, role: 'student' }),
    Course.findById(courseId),
    Semester.findById(semesterId),
  ]);
  if (!student) throw new ApiError(400, 'Invalid student');
  if (!course) throw new ApiError(400, 'Invalid course');
  if (!semester) throw new ApiError(400, 'Invalid semester');

  if (!isUnrestrictedStaff(req.user)) {
    const courseIds = await resolveScopedCourseIds(req.user);
    if (!courseIds.includes(String(course._id))) {
      throw new ApiError(403, 'You can only enroll students in your own assigned Department/Course', null, 'FORBIDDEN');
    }
  }

  try {
    const enrollment = await CourseEnrollment.create({
      student: student._id,
      course: course._id,
      enrollmentType,
      status: 'active',
      academicYear,
      semester: semester._id,
      batch: student.batch || null,
      reason: reason || '',
      approvedBy: req.user._id,
      approvedAt: new Date(),
      history: [{ action: 'created_direct', performedBy: req.user._id, previousStatus: null, newStatus: 'active', reason: reason || '' }],
    });
    await enrollment.populate(POPULATE);
    notifyEnrolled(student, course, enrollment._id, req.user._id);
    res.status(201).json({ success: true, message: 'Enrollment created', data: enrollment });
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw new ApiError(409, 'This student already has an open enrollment for this course');
    }
    throw err;
  }
});

// POST /course-enrollments/bulk-regular — the practical alternative to a
// database migration: enroll every student in a batch into a course as
// 'regular'/'active' in one call, so existing batches can get a real,
// accurate "Regular Courses" list without hand-creating one row per student.
export const bulkEnrollRegular = asyncHandler(async (req, res) => {
  const { courseId, batchId, semesterId, academicYear } = req.body;
  if (!courseId || !batchId || !semesterId || !academicYear) {
    throw new ApiError(400, 'courseId, batchId, semesterId, and academicYear are required');
  }

  const [course, semester] = await Promise.all([Course.findById(courseId), Semester.findById(semesterId)]);
  if (!course) throw new ApiError(400, 'Invalid course');
  if (!semester) throw new ApiError(400, 'Invalid semester');

  if (!isUnrestrictedStaff(req.user)) {
    const courseIds = await resolveScopedCourseIds(req.user);
    if (!courseIds.includes(String(course._id))) {
      throw new ApiError(403, 'You can only bulk-enroll into your own assigned Department/Course', null, 'FORBIDDEN');
    }
  }

  const students = await User.find({ role: 'student', batch: batchId });
  let created = 0;
  let skipped = 0;
  for (const student of students) {
    try {
      const enrollment = await CourseEnrollment.create({
        student: student._id,
        course: course._id,
        enrollmentType: 'regular',
        status: 'active',
        academicYear,
        semester: semester._id,
        batch: batchId,
        approvedBy: req.user._id,
        approvedAt: new Date(),
        history: [{ action: 'created_direct', performedBy: req.user._id, previousStatus: null, newStatus: 'active', reason: 'Bulk regular enrollment' }],
      });
      notifyEnrolled(student, course, enrollment._id, req.user._id);
      created += 1;
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        skipped += 1; // already has an open enrollment for this course
        continue;
      }
      throw err;
    }
  }

  res.status(201).json({
    success: true,
    message: `Enrolled ${created} student(s); skipped ${skipped} with an existing open enrollment`,
    data: { created, skipped, total: students.length },
  });
});

// DELETE /course-enrollments/:id — permanent deletion, Super Admin only
// (route-gated with requireRole('super_admin'), not the permission system).
export const deleteEnrollment = asyncHandler(async (req, res) => {
  const enrollment = await CourseEnrollment.findById(req.params.id);
  if (!enrollment) throw new ApiError(404, 'Enrollment not found');
  await enrollment.deleteOne();
  res.json({ success: true, message: 'Enrollment permanently deleted' });
});
