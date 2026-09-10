import User from '../models/User.js';
import { isSuperAdminTier } from '../models/Role.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  getStudentIdImageStream,
  getPrivateImageStream,
  uploadStudentIdImage,
  deleteStudentIdImage,
  deletePrivateImage,
} from '../services/storage/storageService.js';
import { getSettings } from '../models/Settings.js';
import { getEffectiveCourseIds } from '../services/courseAccessService.js';
import { logger } from '../utils/logger.js';
import { emit } from '../services/notifications/notificationService.js';

const POPULATE = [
  { path: 'department', select: 'name code' },
  { path: 'batch', select: 'name code' },
  { path: 'semester', select: 'name code' },
];

// This controller is reached two ways: the admin-tier `/admin/students/*`
// routes (gated by the 'approvals' permission — super_admin, administrator,
// the unrestricted 'admin' role, or any custom admin-tier Role a Super Admin
// granted it to) and the `/faculty/students/*` routes (gated by
// requireRole('faculty')). Both funnel through the same functions below so
// the workflow logic — scope check, pending-state check, history, storage
// cleanup — is never duplicated between the two entry points.

// Returns `null` for "unrestricted" (super_admin/administrator/admin), a
// `{department, batch}` pair for a scoped admin-tier role (e.g. "CR" — still
// carries its own department/batch from before promotion), or
// `{faculty: user}` for a faculty actor, whose match is checked separately
// in assertApprovalScope/matchesFacultyScope below (department/course, not
// department/batch — faculty has no batch assignment concept in this app,
// see models/User.js's assignedDepartments/assignedCourses).
function resolveApprovalScope(actor) {
  if (isSuperAdminTier(actor.role) || actor.role === 'admin') return null;
  if (actor.role === 'faculty') return { faculty: actor };
  return { department: actor.department, batch: actor.batch };
}

// Faculty scope mirrors fileQueryBuilder.js's isFacultyScopedToFile (OR
// across department/course, the established convention for faculty scope
// checks in this app — see that file's own comment) rather than the CR-style
// strict department+batch AND, since faculty scope is defined by direct
// assignment (assignedDepartments/assignedCourses), not by the faculty
// member's own department/batch (which faculty typically doesn't have set).
// A student has no single "course" the way a File does, so the student's
// side of the match is: their home department, OR any course they can
// reach (their department's courses plus active extra/retake enrollments —
// the same getEffectiveCourseIds union used for upload/submission scoping).
async function matchesFacultyScope(faculty, student) {
  // `student` may come in with `department` already populated (listPendingStudents
  // populates it for display) or as a bare ObjectId (approve/reject fetch it
  // unpopulated) — normalize to the raw id either way before comparing.
  const studentDeptId = student.department?._id || student.department;
  const depts = (faculty.assignedDepartments || []).map(String);
  if (depts.includes(String(studentDeptId))) return true;
  const courses = (faculty.assignedCourses || []).map(String);
  if (!courses.length) return false;
  const studentCourseIds = await getEffectiveCourseIds({ _id: student._id, department: studentDeptId });
  return studentCourseIds.some((id) => courses.includes(id));
}

async function assertApprovalScope(actor, student) {
  const scope = resolveApprovalScope(actor);
  if (!scope) return;
  if (scope.faculty) {
    if (await matchesFacultyScope(scope.faculty, student)) return;
    throw new ApiError(403, 'You can only manage students within your assigned Department/Course', null, 'FORBIDDEN');
  }
  if (String(student.department) !== String(scope.department) || String(student.batch) !== String(scope.batch)) {
    throw new ApiError(403, 'You can only manage students in your own Department and Batch', null, 'FORBIDDEN');
  }
}

// GET /admin/students/pending or /faculty/students/pending — Super
// Admin/Administrator/Admin see the full queue (optionally narrowed by
// department/batch/semester query params, a convenience only they get). A
// scoped role (CR) is ALWAYS force-filtered to its own department+batch, and
// Faculty is ALWAYS force-filtered to students matching their assigned
// department/course — any department/batch/semester query params a scoped
// actor sends are ignored outright, never merged in, so it can't widen its
// own queue by API manipulation.
export const listPendingStudents = asyncHandler(async (req, res) => {
  // Registration no longer collects a Student ID photo — a student can be
  // 'pending' simply because they haven't submitted one yet (nothing for a
  // reviewer to look at). Only surface requests that actually have
  // something submitted, same as the pre-photo-removal behavior where every
  // pending student necessarily had one.
  const filter = {
    role: 'student',
    approvalStatus: 'pending',
    $or: [{ 'studentIdImage.provider': { $in: ['imgbb', 's3'] } }, { studentIdImageKey: { $ne: '' } }],
  };
  const scope = resolveApprovalScope(req.user);

  if (scope?.faculty) {
    const all = await User.find(filter).populate(POPULATE).sort({ createdAt: 1 });
    const matches = await Promise.all(all.map((s) => matchesFacultyScope(scope.faculty, s)));
    const students = all.filter((_, i) => matches[i]);
    return res.json({ success: true, data: students.map((s) => s.toSafeObject()) });
  }

  if (scope) {
    filter.department = scope.department;
    filter.batch = scope.batch;
  } else {
    const { department, batch, semester } = req.query;
    if (department) filter.department = department;
    if (batch) filter.batch = batch;
    if (semester) filter.semester = semester;
  }

  const students = await User.find(filter).populate(POPULATE).sort({ createdAt: 1 });
  res.json({ success: true, data: students.map((s) => s.toSafeObject()) });
});

// GET /admin/students/:id/id-photo or /faculty/students/:id/id-photo —
// authenticated proxy read of the private student-ID image, whichever
// provider it's actually stored under (falls back to the legacy
// studentIdImageKey field for records written before the multi-provider
// studentIdImage subdocument existed — see models/User.js). Never a public
// URL. Scoped the same way approve/reject are — a CR/Faculty can't view a
// photo outside their own scope just by knowing/guessing a student id.
export const getStudentIdPhoto = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+studentIdImageKey +studentIdImage.key');
  if (!user) throw new ApiError(404, 'Student not found');
  await assertApprovalScope(req.user, user);

  if (user.studentIdImage?.key) {
    const { stream, contentType } = await getStudentIdImageStream(user.studentIdImage);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, no-store');
    return stream.pipe(res);
  }
  if (user.studentIdImageKey) {
    const { stream, contentType } = await getPrivateImageStream(user.studentIdImageKey);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, no-store');
    return stream.pipe(res);
  }
  throw new ApiError(404, 'No ID photo on file');
});

export const approveStudent = asyncHandler(async (req, res) => {
  const student = await User.findById(req.params.id);
  if (!student || student.role !== 'student') throw new ApiError(404, 'Student not found');
  await assertApprovalScope(req.user, student);
  if (student.approvalStatus !== 'pending') {
    throw new ApiError(400, 'This student is not pending approval', null, 'BAD_REQUEST');
  }

  student.approvalStatus = 'approved';
  student.approvedBy = req.user._id;
  student.approvedAt = new Date();
  student.approvalRole = req.user.role;
  student.rejectionReason = '';
  student.approvalHistory.push({ action: 'APPROVED', performedBy: req.user._id, performedAt: new Date() });
  student.tokenVersion += 1; // so restricted-material access unlocks on their next request
  await student.save();

  logger.info('Student ID approved', {
    req,
    source: 'studentId',
    meta: { action: 'STUDENT_ID_APPROVED', targetId: student._id, approverRole: req.user.role },
  });
  emit({ type: 'STUDENT_ID_APPROVED', actorId: req.user._id, entityType: 'user', entityId: student._id, recipients: [student._id] }).catch(
    (err) => logger.error(err, { source: 'studentId.notify' })
  );

  res.json({ success: true, message: 'Student approved', data: student.toSafeObject() });
});

export const rejectStudent = asyncHandler(async (req, res) => {
  const student = await User.findById(req.params.id).select('+studentIdImageKey +studentIdImage.key');
  if (!student || student.role !== 'student') throw new ApiError(404, 'Student not found');
  await assertApprovalScope(req.user, student);
  if (student.approvalStatus !== 'pending') {
    throw new ApiError(400, 'This student is not pending approval', null, 'BAD_REQUEST');
  }

  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 1000) : '';
  // Snapshot exactly which storage object belongs to this request before
  // touching the database — deletion below only ever targets this specific
  // reference, never something derived after the fact, so a concurrent
  // resubmission racing this request can't have its NEW image deleted by
  // mistake (see the "never delete an unrelated student's file" rule).
  const imageToDelete = student.studentIdImage?.key ? { ...student.studentIdImage.toObject() } : null;
  const legacyKeyToDelete = !imageToDelete ? student.studentIdImageKey : '';

  student.approvalStatus = 'rejected';
  student.approvedBy = req.user._id;
  student.approvedAt = new Date();
  student.approvalRole = req.user.role;
  student.rejectionReason = reason;
  student.approvalHistory.push({ action: 'REJECTED', performedBy: req.user._id, reason, performedAt: new Date() });
  // Explicit empty shape (not `undefined`) — Mongoose applies schema
  // defaults per-field on assignment, so this reliably clears every field
  // of the embedded subdocument rather than leaving stale values behind.
  student.studentIdImage = { provider: '', url: '', key: '', bucket: '', size: 0, mimeType: '', uploadedAt: null };
  student.studentIdImageKey = '';
  student.tokenVersion += 1;
  await student.save();

  // Only delete from storage after the rejection is durably saved — a save
  // failure above throws before this line is ever reached, leaving the
  // original image untouched.
  if (imageToDelete) {
    deleteStudentIdImage(imageToDelete)
      .then(() => logger.info('Rejected Student ID image deleted', { req, source: 'studentId', meta: { action: 'STUDENT_ID_IMAGE_DELETED', targetId: student._id, provider: imageToDelete.provider, storageKey: imageToDelete.key } }))
      .catch((err) => logger.error(err, { req, source: 'studentId', meta: { action: 'FILE_CLEANUP_FAILED', targetId: student._id } }));
  } else if (legacyKeyToDelete) {
    deletePrivateImage(legacyKeyToDelete).catch((err) => logger.error(err, { req, source: 'studentId', meta: { action: 'FILE_CLEANUP_FAILED', targetId: student._id } }));
  }

  logger.info('Student ID rejected', {
    req,
    source: 'studentId',
    meta: { action: 'STUDENT_ID_REJECTED', targetId: student._id, approverRole: req.user.role, reason },
  });
  emit({
    type: 'STUDENT_ID_REJECTED',
    actorId: req.user._id,
    entityType: 'user',
    entityId: student._id,
    vars: { reason },
    recipients: [student._id],
  }).catch((err) => logger.error(err, { source: 'studentId.notify' }));

  res.json({ success: true, message: 'Student rejected', data: student.toSafeObject() });
});

// POST /student-id/submit — self-service, covers BOTH the first-ever
// submission (registration no longer collects a photo, so a
// studentApprovalEnabled + non-official-email student reaches 'pending'
// with no image yet — see authController.js's register()) and a
// resubmission after rejection. Identity always comes from req.user (the
// authenticated session), never from a client-supplied id — there is no
// :id in this route, so there is nothing for a student to tamper with to
// reach another student's request.
export const submitStudentId = asyncHandler(async (req, res) => {
  const student = await User.findById(req.user._id).select('+studentIdImageKey +studentIdImage.key');
  if (!student || student.role !== 'student') throw new ApiError(403, 'Only students can submit a Student ID', null, 'FORBIDDEN');
  if (!['pending', 'rejected'].includes(student.approvalStatus)) {
    // Covers both "already approved" (including an official-university-email
    // student, for whom Student ID verification is never required at all —
    // spec's Test 8) and "blocked".
    throw new ApiError(400, 'Student ID submission is not required for this account', null, 'BAD_REQUEST');
  }
  if (!req.file) throw new ApiError(400, 'A Student ID photo is required');

  const isResubmission = student.approvalStatus === 'rejected';
  const settings = await getSettings();
  // Upload first — if this throws (invalid image, storage failure), nothing
  // below runs and the student's existing DB state is untouched.
  const newImage = await uploadStudentIdImage(req.file.buffer, req.file.originalname, req.file.mimetype, settings.studentIdStorageProvider);

  const oldImage = student.studentIdImage?.key ? { ...student.studentIdImage.toObject() } : null;
  const oldLegacyKey = !oldImage ? student.studentIdImageKey : '';

  student.studentIdImage = newImage;
  student.studentIdImageKey = '';
  student.approvalStatus = 'pending';
  student.rejectionReason = '';
  student.approvalHistory.push({ action: isResubmission ? 'RESUBMITTED' : 'SUBMITTED', performedBy: req.user._id, performedAt: new Date() });

  try {
    await student.save();
  } catch (err) {
    // The upload succeeded but persisting it failed — clean up the orphan
    // we just created rather than leaving it unreferenced in storage, and
    // leave the student's previous state exactly as it was.
    await deleteStudentIdImage(newImage).catch(() => {});
    throw err;
  }

  // Only now, after the new image is durably the one on record, remove the
  // old (rejected) one, if any — never the other way around.
  if (oldImage) {
    deleteStudentIdImage(oldImage).catch((err) => logger.error(err, { req, source: 'studentId', meta: { action: 'FILE_CLEANUP_FAILED', targetId: student._id } }));
  } else if (oldLegacyKey) {
    deletePrivateImage(oldLegacyKey).catch((err) => logger.error(err, { req, source: 'studentId', meta: { action: 'FILE_CLEANUP_FAILED', targetId: student._id } }));
  }

  logger.info(isResubmission ? 'Student ID resubmitted' : 'Student ID submitted', {
    req,
    source: 'studentId',
    meta: { action: isResubmission ? 'STUDENT_ID_RESUBMITTED' : 'STUDENT_ID_SUBMITTED', targetId: student._id },
  });

  res.json({ success: true, message: 'Student ID submitted, pending review', data: student.toSafeObject() });
});

// GET /student-id/status — self-service status read. Not strictly required
// by the client today (AuthContext already carries approvalStatus/
// rejectionReason on the cached user from /auth/me), but exposed as its own
// endpoint per the spec so a client can re-check status without a full
// /auth/me round trip.
export const getMyStudentIdStatus = asyncHandler(async (req, res) => {
  const student = await User.findById(req.user._id);
  if (!student) throw new ApiError(404, 'Not found');
  res.json({
    success: true,
    data: {
      approvalStatus: student.approvalStatus,
      rejectionReason: student.rejectionReason,
      approvalHistory: student.approvalHistory,
    },
  });
});
