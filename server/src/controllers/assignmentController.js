import fs from 'node:fs/promises';
import Assignment from '../models/Assignment.js';
import Submission from '../models/Submission.js';
import Course from '../models/Course.js';
import { getSettings } from '../models/Settings.js';
import { isAdminTierRole, isSuperAdminTier } from '../models/Role.js';
import { getEffectiveCourseIds, isBlockedByApproval } from '../services/courseAccessService.js';
import { assertBatchesMatchCourses } from '../services/teachingService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { storeUploadedFileFromPath, deleteStoredFile } from '../services/storage/storageService.js';
import { recordDomainOptimization } from '../services/uploads/metadata/recordBridge.js';
import { emit } from '../services/notifications/notificationService.js';
import { resolveCourseScopedRecipients, resolveFacultyForCourse } from '../services/notifications/recipientResolver.js';

// An assignment can target multiple courses at once — fan out per course
// (each may have a different enrolled population) and de-dupe recipients.
async function resolveAssignmentRecipients(assignment) {
  if (!assignment.courses?.length) return [];
  const perCourse = await Promise.all(
    assignment.courses.map((course) => resolveCourseScopedRecipients({ course, batches: assignment.batches, semesters: assignment.semesters }))
  );
  return [...new Set(perCourse.flat().map(String))];
}

function notifyAssignmentPublished(assignment, actor, type) {
  resolveAssignmentRecipients(assignment)
    .then((recipients) =>
      emit({
        type,
        actorId: actor._id,
        entityType: 'ASSIGNMENT',
        entityId: assignment._id,
        vars: {
          title: assignment.title,
          assignmentId: assignment._id,
          deadline: assignment.deadline ? new Date(assignment.deadline).toDateString() : '',
        },
        recipients,
      })
    )
    .catch((err) => console.error('[notify] assignment publish', err));
}

/**
 * Tells the people who set the assignment that a student handed it in. Until now
 * nothing did — a faculty member had to open the submissions list to discover
 * whether anyone had submitted. Recipients are the assignment's creator plus the
 * faculty teaching each of its courses; `emit` drops the submitting student.
 */
async function notifySubmissionReceived(assignment, submission, student) {
  const perCourse = await Promise.all(
    (assignment.courses || []).map((course) => resolveFacultyForCourse(course))
  );
  const recipients = [...new Set([...perCourse.flat().map(String), String(assignment.createdBy)])];
  return emit({
    type: 'ASSIGNMENT_SUBMITTED',
    actorId: student._id,
    entityType: 'SUBMISSION',
    entityId: submission._id,
    vars: { title: assignment.title, assignmentId: assignment._id, studentName: student.name },
    recipients,
  });
}

async function assertAssignmentSystemEnabled() {
  const settings = await getSettings();
  if (!settings.assignmentSystemEnabled) {
    throw new ApiError(400, 'The assignment system is currently disabled');
  }
}

const POPULATE = [
  { path: 'departments', select: 'name code' },
  { path: 'courses', select: 'name courseId' },
  { path: 'batches', select: 'name code' },
  { path: 'semesters', select: 'name code' },
  { path: 'createdBy', select: 'name role' },
];

function parseTargeting(body) {
  return {
    departments: [].concat(body.departments || []).filter(Boolean),
    courses: [].concat(body.courses || []).filter(Boolean),
    batches: [].concat(body.batches || []).filter(Boolean),
    semesters: [].concat(body.semesters || []).filter(Boolean),
  };
}

function assertHasTarget(targeting) {
  if (!targeting.departments.length && !targeting.courses.length && !targeting.batches.length && !targeting.semesters.length) {
    throw new ApiError(400, 'Select at least one department, course, batch, or semester to target');
  }
}

/**
 * Course page → the Assignments tab: narrow a listing to one course and/or one
 * batch. Purely additive to whatever filter the caller already had, so it can
 * only *reduce* what they see — a student passing someone else's course id gets
 * nothing, never more.
 */
function applyCourseScope(query, filter) {
  if (query.course) filter.courses = query.course;
  if (query.batch) filter.batches = query.batch;
}

// Faculty may only target their own assigned Department(s)/Course(s) —
// identical rule to notices (see noticeController.js).
//
// A course also counts as theirs when its department is assigned to them
// wholesale. That is the rule GET /faculty/courses already uses to build the
// course list, so without it the UI would offer courses in a department-assigned
// faculty member's own My Courses that this check then refused.
async function assertFacultyTargetingScope(targeting, user) {
  const deptIds = new Set((user.assignedDepartments || []).map(String));
  const courseIds = new Set((user.assignedCourses || []).map(String));

  if (targeting.departments.some((d) => !deptIds.has(String(d)))) {
    throw new ApiError(403, 'You can only target your own assigned Department(s)/Course(s)', null, 'FORBIDDEN');
  }

  const notDirectlyAssigned = targeting.courses.filter((c) => !courseIds.has(String(c)));
  if (!notDirectlyAssigned.length) return;

  const viaDepartment = await Course.find({
    _id: { $in: notDirectlyAssigned },
    department: { $in: [...deptIds] },
  }).distinct('_id');
  const allowed = new Set(viaDepartment.map(String));

  if (notDirectlyAssigned.some((c) => !allowed.has(String(c)))) {
    throw new ApiError(403, 'You can only target your own assigned Department(s)/Course(s)', null, 'FORBIDDEN');
  }
}

function assertManageAccess(assignment, user) {
  if (user.role === 'super_admin' || user.role === 'administrator') return;
  if (!assignment.createdBy.equals(user._id)) {
    throw new ApiError(403, 'You can only manage assignments you created', null, 'FORBIDDEN');
  }
}

/**
 * Stores spooled attachments without buffering them in the heap.
 *
 * Returns the attachment documents AND a parallel `spool` array carrying the
 * provenance the pipeline needs (provider, key, mime, size). The two are index-
 * aligned, so after the document is saved the optimization jobs can be recorded
 * against each attachment's own `_id`.
 */
async function storeAttachments(files, ownerId, purpose = 'assignment') {
  const attachments = [];
  const spool = [];
  for (const file of files || []) {
    const stored = await storeUploadedFileFromPath(file.path, file.originalname, file.mimetype, {
      purpose,
      ownerId: String(ownerId),
      size: file.size,
    });
    await fs.rm(file.path, { force: true }).catch(() => null);
    attachments.push({
      originalName: file.originalname,
      fileUrl: stored.fileUrl,
      storageProvider: stored.storageProvider,
      storageRef: stored.storageRef,
    });
    spool.push({
      storageProvider: stored.storageProvider,
      storageRef: stored.storageRef,
      mimeType: file.mimetype,
      originalName: file.originalname,
      fileSize: stored.size || file.size,
    });
  }
  return { attachments, spool };
}

/** Records each saved attachment with the pipeline so it is optimized async. */
async function queueAttachmentOptimization({ kind, ownerId, recordId, doc, spool }) {
  const items = [];
  (doc.attachments || []).forEach((attachment, index) => {
    const descriptor = spool[index];
    if (descriptor) items.push({ attachmentId: attachment._id, ...descriptor });
  });
  if (!items.length) return;
  await recordDomainOptimization({ ownerId, kind, recordId, purpose: kind, items }).catch(() => null);
}

// Extracts a comparable id string whether `v` is a raw ObjectId or an
// already-`.populate()`d document (getAssignment populates `assignment`
// before calling userMatchesTargeting, so departments/courses/etc. arrive as
// full sub-documents there, not ids — String(populatedDoc) would silently
// never match anything without this).
function idStr(v) {
  return String((v && v._id) || v);
}

// A user "matches" an assignment's targeting if every non-empty axis
// contains something of theirs — same AND-across-axes/OR-within-axis rule
// as File.restrictions. `courses` is matched via getEffectiveCourseIds — the
// student's department's course list PLUS any course they have an
// active/approved CourseEnrollment for (e.g. a retake outside their own
// department/semester).
async function userMatchesTargeting(user, assignment) {
  const deptOk = !assignment.departments?.length || assignment.departments.some((d) => idStr(d) === idStr(user.department));
  const batchOk = !assignment.batches?.length || assignment.batches.some((b) => idStr(b) === idStr(user.batch));
  const semOk = !assignment.semesters?.length || assignment.semesters.some((s) => idStr(s) === idStr(user.semester));

  let courseOk = true;
  if (assignment.courses?.length) {
    const effectiveCourseIds = await getEffectiveCourseIds(user);
    const effectiveCourseIdSet = new Set(effectiveCourseIds);
    courseOk = assignment.courses.some((c) => effectiveCourseIdSet.has(idStr(c)));
  }
  return deptOk && batchOk && semOk && courseOk;
}

async function audienceMongoFilter(user) {
  const matches = {
    $and: [
      { $or: [{ 'departments.0': { $exists: false } }, { departments: user.department }] },
      { $or: [{ 'batches.0': { $exists: false } }, { batches: user.batch }] },
      { $or: [{ 'semesters.0': { $exists: false } }, { semesters: user.semester }] },
    ],
  };
  const effectiveCourseIds = await getEffectiveCourseIds(user);
  if (effectiveCourseIds.length) {
    matches.$and.push({ $or: [{ 'courses.0': { $exists: false } }, { courses: { $in: effectiveCourseIds } }] });
  } else {
    matches.$and.push({ 'courses.0': { $exists: false } });
  }
  return matches;
}

export const createAssignment = asyncHandler(async (req, res) => {
  await assertAssignmentSystemEnabled();
  const { title, description, startDate, deadline, maxMarks, submissionType, allowResubmission } = req.body;
  if (!deadline) throw new ApiError(400, 'Deadline is required');
  if (maxMarks === undefined) throw new ApiError(400, 'Max marks is required');

  const targeting = parseTargeting(req.body);
  assertHasTarget(targeting);
  if (req.user.role === 'faculty') await assertFacultyTargetingScope(targeting, req.user);
  // A batch from another department would aim the assignment at a group that
  // can never be enrolled in the targeted course.
  await assertBatchesMatchCourses(targeting);

  const { attachments, spool } = await storeAttachments(req.files, req.user._id, 'assignment');

  const assignment = await Assignment.create({
    title,
    description,
    ...targeting,
    startDate: startDate || undefined,
    deadline,
    attachments,
    maxMarks: Number(maxMarks),
    submissionType: submissionType || 'file',
    allowResubmission: allowResubmission === 'true' || allowResubmission === true,
    status: req.body.status === 'published' ? 'published' : 'draft',
    createdBy: req.user._id,
  });

  await queueAttachmentOptimization({ kind: 'assignment', ownerId: req.user._id, recordId: assignment._id, doc: assignment, spool });

  if (assignment.status === 'published') notifyAssignmentPublished(assignment, req.user, 'ASSIGNMENT_CREATED');
  res.status(201).json({ success: true, data: assignment });
});

export const updateAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) throw new ApiError(404, 'Assignment not found');
  assertManageAccess(assignment, req.user);
  const wasPublished = assignment.status === 'published';

  const allowed = ['title', 'description', 'startDate', 'deadline', 'maxMarks', 'submissionType', 'allowResubmission', 'status'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      if (key === 'maxMarks') assignment.maxMarks = Number(req.body.maxMarks);
      else if (key === 'allowResubmission') assignment.allowResubmission = req.body.allowResubmission === 'true' || req.body.allowResubmission === true;
      else assignment[key] = req.body[key];
    }
  }

  if (req.body.departments || req.body.courses || req.body.batches || req.body.semesters) {
    const targeting = parseTargeting(req.body);
    assertHasTarget(targeting);
    if (req.user.role === 'faculty') await assertFacultyTargetingScope(targeting, req.user);
    await assertBatchesMatchCourses(targeting);
    Object.assign(assignment, targeting);
  }

  let spool = [];
  if (req.files?.length) {
    await Promise.all((assignment.attachments || []).map((a) => deleteStoredFile(a).catch(() => null)));
    const stored = await storeAttachments(req.files, req.user._id, 'assignment');
    assignment.attachments = stored.attachments;
    spool = stored.spool;
  }

  await assignment.save();

  await queueAttachmentOptimization({ kind: 'assignment', ownerId: req.user._id, recordId: assignment._id, doc: assignment, spool });

  if (!wasPublished && assignment.status === 'published') notifyAssignmentPublished(assignment, req.user, 'ASSIGNMENT_CREATED');
  else if (wasPublished && assignment.status === 'published') notifyAssignmentPublished(assignment, req.user, 'ASSIGNMENT_UPDATED');

  res.json({ success: true, data: assignment });
});

export const deleteAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) throw new ApiError(404, 'Assignment not found');
  assertManageAccess(assignment, req.user);

  await Promise.all((assignment.attachments || []).map((a) => deleteStoredFile(a).catch(() => null)));

  // Every student's submitted file(s) also live in storage — deleting only
  // the DB rows below would orphan them in S3/R2 forever.
  const submissions = await Submission.find({ assignment: assignment._id }).select('attachments');
  await Promise.all(submissions.flatMap((s) => (s.attachments || []).map((a) => deleteStoredFile(a).catch(() => null))));

  await Submission.deleteMany({ assignment: assignment._id });
  await assignment.deleteOne();

  res.json({ success: true, message: 'Assignment deleted' });
});

// GET /assignments/mine — the creator's own assignments (or all, for
// super_admin), for management — any status, not just published.
export const listMyAssignments = asyncHandler(async (req, res) => {
  const filter = isSuperAdminTier(req.user.role) ? {} : { createdBy: req.user._id };
  applyCourseScope(req.query, filter);
  const assignments = await Assignment.find(filter).populate(POPULATE).sort({ createdAt: -1 });
  res.json({ success: true, data: assignments });
});

// GET /assignments — the audience view: published assignments relevant to
// the requesting user. Deliberately role-agnostic (not just 'student') so
// an Admin acting as a class CR can see and submit assignments targeted at
// their own department/batch/semester too.
export const listRelevantAssignments = asyncHandler(async (req, res) => {
  await assertAssignmentSystemEnabled();

  // A pending/rejected student can't see assignments at all (they're always
  // login-required, no public/restricted split like Files) until an Admin
  // approves them — same all-or-nothing gate as file content.
  if (await isBlockedByApproval(req.user)) {
    return res.json({ success: true, data: [], blockedByApproval: true });
  }

  let filter = { status: { $in: ['published', 'closed'] } };
  applyCourseScope(req.query, filter);
  if (!isSuperAdminTier(req.user.role) && !(await isAdminTierRole(req.user.role))) {
    filter = { ...filter, ...(await audienceMongoFilter(req.user)) };
  }

  const assignments = await Assignment.find(filter).populate(POPULATE).sort({ deadline: 1 });

  const submissions = await Submission.find({ assignment: { $in: assignments.map((a) => a._id) }, student: req.user._id });
  const byAssignment = new Map(submissions.map((s) => [String(s.assignment), s]));

  res.json({
    success: true,
    data: assignments.map((a) => ({
      ...a.toObject(),
      mySubmission: byAssignment.get(String(a._id)) || null,
    })),
  });
});

export const getAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id).populate(POPULATE);
  if (!assignment) throw new ApiError(404, 'Assignment not found');

  const isManager = isSuperAdminTier(req.user.role) || assignment.createdBy._id.equals(req.user._id);
  if (!isManager) {
    if (assignment.status === 'draft') throw new ApiError(403, 'This assignment is not published', null, 'FORBIDDEN');
    if (!(await isAdminTierRole(req.user.role))) {
      if (await isBlockedByApproval(req.user)) {
        throw new ApiError(403, 'Your account is pending admin approval', null, 'FORBIDDEN');
      }
      if (!(await userMatchesTargeting(req.user, assignment))) {
        throw new ApiError(403, 'This assignment is not targeted to you', null, 'FORBIDDEN');
      }
    }
  }

  res.json({ success: true, data: assignment });
});

// ----- Submissions -----

export const submitAssignment = asyncHandler(async (req, res) => {
  await assertAssignmentSystemEnabled();
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) throw new ApiError(404, 'Assignment not found');
  if (assignment.status !== 'published') throw new ApiError(400, 'This assignment is not accepting submissions');

  const isManager = isSuperAdminTier(req.user.role) || assignment.createdBy.equals(req.user._id);
  if (!isManager && !(await isAdminTierRole(req.user.role))) {
    if (await isBlockedByApproval(req.user)) {
      throw new ApiError(403, 'Your account is pending admin approval', null, 'FORBIDDEN');
    }
    if (!(await userMatchesTargeting(req.user, assignment))) {
      throw new ApiError(403, 'This assignment is not targeted to you', null, 'FORBIDDEN');
    }
  }

  const existing = await Submission.findOne({ assignment: assignment._id, student: req.user._id });
  if (existing && existing.status === 'graded') {
    throw new ApiError(409, 'This submission has already been graded and cannot be replaced');
  }
  if (existing && !assignment.allowResubmission) {
    throw new ApiError(409, 'Resubmission is not allowed for this assignment');
  }

  if (assignment.submissionType !== 'file' && !req.body.text) {
    throw new ApiError(400, 'Text submission is required');
  }
  const files = req.files && req.files.length ? req.files : [];
  if (assignment.submissionType !== 'text' && !files.length && !existing) {
    throw new ApiError(400, 'A file submission is required');
  }

  if (existing) {
    await Promise.all((existing.attachments || []).map((a) => deleteStoredFile(a).catch(() => null)));
  }

  let attachments = existing?.attachments || [];
  let spool = [];
  if (files.length) {
    const stored = await storeAttachments(files, req.user._id, 'submission');
    attachments = stored.attachments;
    spool = stored.spool;
  }
  const submittedAt = new Date();
  const status = submittedAt > assignment.deadline ? 'late' : 'submitted';

  const submission = await Submission.findOneAndUpdate(
    { assignment: assignment._id, student: req.user._id },
    {
      text: req.body.text || '',
      attachments,
      submittedAt,
      status,
      $unset: { marks: '', feedback: '', gradedBy: '', gradedAt: '' },
    },
    { upsert: true, new: true }
  );

  await queueAttachmentOptimization({ kind: 'submission', ownerId: req.user._id, recordId: submission._id, doc: submission, spool });

  notifySubmissionReceived(assignment, submission, req.user).catch((err) =>
    console.error('[notify] assignment submitted', err)
  );

  res.status(201).json({ success: true, message: status === 'late' ? 'Submitted (late)' : 'Submitted', data: submission });
});

export const getMySubmission = asyncHandler(async (req, res) => {
  const submission = await Submission.findOne({ assignment: req.params.id, student: req.user._id });
  res.json({ success: true, data: submission });
});

// GET /assignments/my-submissions — every submission the requester has made,
// across all assignments, for "view marks and feedback".
export const listMySubmissions = asyncHandler(async (req, res) => {
  const submissions = await Submission.find({ student: req.user._id })
    .populate({ path: 'assignment', select: 'title maxMarks deadline status' })
    .sort({ createdAt: -1 });
  res.json({ success: true, data: submissions });
});

// GET /assignments/:id/submissions — staff view, for grading.
export const listSubmissions = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) throw new ApiError(404, 'Assignment not found');
  assertManageAccess(assignment, req.user);

  const submissions = await Submission.find({ assignment: assignment._id })
    .populate({ path: 'student', select: 'name email rollNo department batch', populate: [{ path: 'department', select: 'code' }, { path: 'batch', select: 'name' }] })
    .sort({ submittedAt: -1 });

  res.json({ success: true, data: submissions });
});

// GET /assignments/:id/submissions/export — CSV of every submission and its
// grade, same scope/access rule and query as listSubmissions.
export const exportSubmissions = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) throw new ApiError(404, 'Assignment not found');
  assertManageAccess(assignment, req.user);

  const submissions = await Submission.find({ assignment: assignment._id })
    .populate({ path: 'student', select: 'name email rollNo department batch', populate: [{ path: 'department', select: 'code' }, { path: 'batch', select: 'name' }] })
    .sort({ submittedAt: -1 });

  const escapeCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['Name', 'Email', 'Roll No', 'Department', 'Batch', 'Status', 'Marks', 'Max Marks', 'Feedback', 'Submitted At', 'Graded At'];
  const rows = submissions.map((s) =>
    [
      s.student?.name || '',
      s.student?.email || '',
      s.student?.rollNo || '',
      s.student?.department?.code || '',
      s.student?.batch?.name || '',
      s.status,
      s.marks ?? '',
      assignment.maxMarks,
      s.feedback || '',
      s.submittedAt ? s.submittedAt.toISOString() : '',
      s.gradedAt ? s.gradedAt.toISOString() : '',
    ]
      .map(escapeCsv)
      .join(',')
  );
  const csv = [header.join(','), ...rows].join('\n');

  const safeTitle = assignment.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '') || 'assignment';
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}-submissions.csv"`);
  res.send(csv);
});

export const gradeSubmission = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) throw new ApiError(404, 'Assignment not found');
  assertManageAccess(assignment, req.user);

  const { marks, feedback } = req.body;
  if (marks === undefined || Number.isNaN(Number(marks))) throw new ApiError(400, 'marks is required');
  if (Number(marks) > assignment.maxMarks) throw new ApiError(400, `marks cannot exceed maxMarks (${assignment.maxMarks})`);

  const previous = await Submission.findOne({ _id: req.params.submissionId, assignment: assignment._id }).select('status');
  if (!previous) throw new ApiError(404, 'Submission not found');
  // A second grading of the same submission is a changed grade, not a first
  // result — the two are separate notifications so neither is ever a duplicate.
  const regrade = previous.status === 'graded';

  const submission = await Submission.findOneAndUpdate(
    { _id: req.params.submissionId, assignment: assignment._id },
    { marks: Number(marks), feedback: feedback || '', status: 'graded', gradedBy: req.user._id, gradedAt: new Date() },
    { new: true }
  );
  if (!submission) throw new ApiError(404, 'Submission not found');

  emit({
    type: regrade ? 'GRADE_PUBLISHED' : 'ASSIGNMENT_RESULT',
    actorId: req.user._id,
    entityType: 'SUBMISSION',
    entityId: submission._id,
    vars: { title: assignment.title, assignmentId: assignment._id, marks: submission.marks, maxMarks: assignment.maxMarks },
    recipients: [submission.student],
  }).catch((err) => console.error('[notify] grade submission', err));

  res.json({ success: true, data: submission });
});
