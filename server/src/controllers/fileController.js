import fs from 'node:fs/promises';
import { Readable } from 'stream';
import File from '../models/File.js';
import Department from '../models/Department.js';
import Course from '../models/Course.js';
import Batch from '../models/Batch.js';
import Semester from '../models/Semester.js';
import Category from '../models/Category.js';
import Chapter from '../models/Chapter.js';
import Topic from '../models/Topic.js';
import Bookmark from '../models/Bookmark.js';
import StoredFile from '../models/StoredFile.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { storeUploadedFileFromPath, deleteStoredFile, deleteStoredFileStrict } from '../services/storage/storageService.js';
import { queueMaterialOptimization } from '../services/uploads/metadata/materialBridge.js';
import { uploadcareCdnUrl } from '../services/storage/uploadcareStorage.js';
import { resolveDocumentType } from '../utils/fileTypes.js';
import {
  buildFileQuery,
  buildSortOption,
  buildAccessContext,
  attachFileLocks,
  userCanAccessFile,
  isFacultyScopedToFile,
} from '../services/fileQueryBuilder.js';
import { fuzzyRankFiles, rankFileCandidates, suggestFileCorrection } from '../services/fuzzyFileSearch.js';
import { sanitizeQuery } from '../utils/textSearch.js';
import { parsePagination } from '../utils/pagination.js';
import { getSettings } from '../models/Settings.js';
import { emit } from '../services/notifications/notificationService.js';
import { resolveCourseScopedRecipients, resolveReviewersForCourse } from '../services/notifications/recipientResolver.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getEffectiveCourseIds, isBlockedByApproval } from '../services/courseAccessService.js';
import { assertBatchesForCourse } from '../services/teachingService.js';
import { isSuperAdminTier, getRole } from '../models/Role.js';
import { isValidHttpsUrl } from '../utils/externalUrl.js';

// Fire-and-forget: never blocks the response, never throws into the
// controller — a notification failure must not fail a file upload.
function notifyCourseMaterial(file, actor, type) {
  resolveCourseScopedRecipients({ course: file.course, batches: file.allBatches ? [] : file.batches })
    .then((recipients) =>
      emit({
        type,
        actorId: actor._id,
        entityType: 'FILE',
        entityId: file._id,
        course: file.course,
        department: file.department,
        vars: { actorName: actor.name, fileName: file.title, courseName: file.courseName, fileId: file._id },
        recipients,
      })
    )
    .catch((err) => logger.error(err, { source: 'notifyCourseMaterial' }));
}

// A student's own submission lands in the review queue, so the people told about
// it are the reviewers who work that queue — the CR/admin-tier reviewers, not
// faculty (see resolveReviewersForCourse; faculty can be added back by env var).
// Distinct from notifyCourseMaterial: that is staff publishing material, this is
// material arriving to be reviewed. In-app + push always; the email copy rides
// the NOTIFICATION_EMAIL_ENABLED switch inside emit().
function notifyReviewRequest(file, actor) {
  resolveReviewersForCourse(file.course, {
    includeFaculty: env.notifications.notifyFacultyOnStudentUpload,
  })
    .then((recipients) =>
      emit({
        type: 'FILE_UPLOADED',
        actorId: actor._id,
        entityType: 'FILE',
        entityId: file._id,
        course: file.course,
        department: file.department,
        vars: { actorName: actor.name, fileName: file.title, courseName: file.courseName, fileId: file._id },
        recipients,
      })
    )
    .catch((err) => logger.error(err, { source: 'notifyReviewRequest' }));
}

const LIST_FIELDS = [
  'title',
  'originalName',
  'fileType',
  'mimeType',
  'fileSize',
  'fileUrl',
  'fileCount',
  'departmentCode',
  'courseName',
  'courseId',
  'batchCodes',
  'allBatches',
  'semester',
  'academicYear',
  'categoryName',
  'views',
  'downloads',
  'createdAt',
];
const LIST_SELECT = LIST_FIELDS.join(' ');

function listProjection() {
  return Object.fromEntries(LIST_FIELDS.map((f) => [f, 1]));
}

// `visibility`/`restrictions` are only ever fetched to compute the `locked`
// flag (attachFileLocks strips them back off before the response is sent) —
// used by every public listing surface that shows locked files instead of
// excluding them.
const LOCK_SELECT = `${LIST_SELECT} visibility restrictions`;
function lockProjection() {
  return { ...listProjection(), visibility: 1, restrictions: 1 };
}

// Shared by every "my files / assigned files" search box: fuzzy-ranks
// `scopeFilter`'s candidates against `q` and sends the paginated response.
// Callers only ever reach this once `q` has already cleared the
// sanitizeQuery(q).length >= 2 gate.
async function respondWithFuzzyFiles(res, scopeFilter, q, page, limit) {
  const { ranked, queryTokens, candidates } = await rankFileCandidates(scopeFilter, q);
  const total = ranked.length;
  const start = (page - 1) * limit;
  const pageItems = ranked.slice(start, start + limit);

  const data = pageItems.map(({ file, score, matchType }) => {
    const obj = file.toObject();
    obj.score = score;
    obj.matchType = matchType;
    return obj;
  });

  const suggestion = suggestFileCorrection(queryTokens, candidates, pageItems[0]?.matchType || 'none');

  res.json({
    success: true,
    data,
    correctedQuery: suggestion || undefined,
    suggestion: suggestion || undefined,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}

// Resolves the department/course/category/batches shared by every
// attachment in one upload — used by both the direct-upload and the
// Uploadcare-attach endpoints so they build File entries identically.
async function resolveUploadMetadata(body) {
  const { departmentId, courseIdRef, categoryId, keywords, chapterId, topicId } = body;
  const batchIds = body.batches ? [].concat(body.batches) : [];
  const allBatches = body.allBatches === 'true' || body.allBatches === true;

  const [department, course, category, chapter, topic] = await Promise.all([
    Department.findById(departmentId),
    Course.findById(courseIdRef),
    Category.findById(categoryId),
    chapterId ? Chapter.findById(chapterId) : null,
    topicId ? Topic.findById(topicId) : null,
  ]);
  if (!department) throw new ApiError(400, 'Invalid department');
  if (!course) throw new ApiError(400, 'Invalid course');
  if (!category) throw new ApiError(400, 'Invalid category');
  if (chapterId && !chapter) throw new ApiError(400, 'Invalid chapter');
  if (topicId && !topic) throw new ApiError(400, 'Invalid topic');
  // A course belongs to exactly one department — the client submits both
  // ids separately, so without this check a caller could tag a File under
  // a department that doesn't actually match its course (and, for Faculty,
  // use an assigned course's id to smuggle in an unassigned departmentId).
  if (String(course.department) !== String(department._id)) {
    throw new ApiError(400, 'Course does not belong to the selected department');
  }

  let batches = [];
  let batchCodes = [];
  if (!allBatches && batchIds.length) {
    // Goes through the same check the assignment/quiz create paths use: every
    // batch must belong to this course's department, so material can never be
    // filed against a group that could not be enrolled in the course. Also
    // rejects unknown batch ids rather than silently ignoring them.
    const found = await assertBatchesForCourse(course, batchIds);
    batchCodes = found.map((b) => b.code);
    batches = found.map((b) => b._id);
  }

  const keywordList = keywords ? String(keywords).split(',').map((k) => k.trim()).filter(Boolean) : [];

  const visibility = body.visibility === 'public' ? 'public' : 'login_required';
  const restrictions = {
    departments: body.restrictDepartments ? [].concat(body.restrictDepartments) : [],
    batches: body.restrictBatches ? [].concat(body.restrictBatches) : [],
    semesters: body.restrictSemesters ? [].concat(body.restrictSemesters) : [],
    courses: body.restrictCourses ? [].concat(body.restrictCourses) : [],
  };

  return { department, course, category, chapter, topic, batches, batchCodes, allBatches, keywordList, visibility, restrictions };
}

/**
 * The batch and semester a Student/CR submission is filed under, taken from the
 * submitter's OWN profile rather than from the request.
 *
 * <p>A student does not choose which batch or semester they are in, so the
 * submission form does not ask and this derives both. Doing it server-side —
 * rather than trusting whatever the form happens to send — is the point: a
 * crafted request cannot file material under a batch or semester that is not the
 * submitter's. Both clients therefore stopped sending these fields entirely.
 *
 * <p>Two fallbacks, so this can never block a legitimate submission:
 * <ul>
 *   <li>A batch that does not belong to the submitted course's department is
 *       DROPPED rather than rejected. A student taking a course from another
 *       department (an approved retake or extra enrolment) legitimately has their
 *       own batch, but it is not a batch of that course — so the material is
 *       filed without batch targeting, exactly as an un-picked batch always was.</li>
 *   <li>No batch on the profile leaves no batch on the record, which reads as
 *       "applies to all batches" — the shape this endpoint produced before the
 *       batch picker existed.</li>
 * </ul>
 *
 * @returns {Promise<{batchIds: Array, batchCodes: string[], allBatches: boolean, semester: string}>}
 */
async function resolveSubmitterScope(user, course) {
  const batch = user.batch ? await Batch.findById(user.batch) : null;
  const semester = user.semester ? await Semester.findById(user.semester) : null;
  return submissionScope(batch, semester, course);
}

/**
 * The rule itself, given the records rather than their ids.
 *
 * <p>Split out from the lookups above so it can be tested without a database —
 * this decides what a submission is filed under, so it is worth pinning
 * directly rather than only through a controller that needs a fixture of
 * Department, Course, Batch, Semester and User documents to run at all.
 *
 * @param {object|null} batch    the submitter's own Batch record
 * @param {object|null} semester the submitter's own Semester record
 * @param {object} course        the course being submitted to
 */
export function submissionScope(batch, semester, course) {
  const scope = { batchIds: [], batchCodes: [], allBatches: false, semester: '' };

  // Only a batch of the course's own department is used. Anything else is
  // dropped, not rejected: a student taking a course from another department
  // legitimately has their own batch, but it is not a batch of that course.
  //
  // Both sides must be SET as well as equal. `String(null) === String(null)`, so
  // without the presence checks a department-agnostic batch would appear to match
  // a course that also had none — and the submission would be filed under a batch
  // nobody asked for. An unset department on either side means no match, which
  // fails toward LESS targeting.
  if (batch && batch.department && course.department
      && String(batch.department) === String(course.department)) {
    scope.batchIds = [batch._id];
    scope.batchCodes = [batch.code];
  }

  // The File's `semester` is the Semester's NAME, because that is what
  // Course.semester holds and what every filter compares against.
  if (semester && semester.name) {
    scope.semester = semester.name;
  }

  return scope;
}

// The selected course must belong to the selected semester. Course.semester is
// a free-text label that matches Semester.name (the only link between the two
// the data has), and Course.semester is often empty on legacy rows — so an
// empty course semester is deliberately grandfathered rather than rejected,
// while a course that does declare a semester must match exactly. This is what
// stops a client from posting a course outside the semester it offered in the
// dropdown; the client list is a convenience, never the enforcement point.
function assertSemesterMatchesCourse(course, semester) {
  const label = typeof semester === 'string' ? semester.trim() : '';
  if (!label) return;
  const courseSemester = typeof course?.semester === 'string' ? course.semester.trim() : '';
  if (courseSemester && courseSemester !== label) {
    throw new ApiError(400, 'The selected course does not belong to the selected semester', null, 'SEMESTER_MISMATCH');
  }
}

// An external-link submission: no upload, just a validated HTTPS URL. It gets
// one synthetic attachment descriptor so every consumer that expects
// attachments[] to be non-empty (cards, viewers, preview, delete) keeps working
// — with storageProvider 'external' there is simply no object to delete.
function buildExternalSubmission(externalUrl, title) {
  const attachment = {
    originalName: title || 'External link',
    fileName: externalUrl,
    fileType: 'other',
    mimeType: 'text/uri-list',
    fileSize: 0,
    fileUrl: externalUrl,
    storageProvider: 'external',
    storageRef: '',
  };
  return {
    uploadType: 'external',
    externalUrl,
    attachments: [attachment],
  };
}

// Creates one File entry (with an `attachments[]` of one or more physical
// files) from already-prepared attachment descriptors + shared metadata.
async function createGroupedFile({ attachments, title, description, semester, academicYear, meta, uploadedBy, approvalStatus, uploadType = 'file', externalUrl = '' }) {
  const primary = attachments[0];
  const totalSize = attachments.reduce((sum, a) => sum + a.fileSize, 0);

  return File.create({
    title: title || stripExtension(primary.originalName),
    originalName: primary.originalName,
    fileName: primary.fileName,
    fileType: primary.fileType,
    mimeType: primary.mimeType,
    fileSize: totalSize,
    fileUrl: primary.fileUrl,
    storageProvider: primary.storageProvider,
    storageRef: primary.storageRef,
    attachments,
    fileCount: attachments.length,
    uploadType,
    externalUrl,
    department: meta.department._id,
    departmentCode: meta.department.code,
    course: meta.course._id,
    courseName: meta.course.name,
    courseId: meta.course.courseId,
    batches: meta.batches,
    batchCodes: meta.batchCodes,
    allBatches: meta.allBatches,
    semester: semester || '',
    academicYear: academicYear || '',
    category: meta.category._id,
    categoryName: meta.category.name,
    chapter: meta.chapter?._id || null,
    chapterName: meta.chapter?.name || '',
    topic: meta.topic?._id || null,
    topicName: meta.topic?.name || '',
    description: description || '',
    keywords: meta.keywordList,
    uploadedBy,
    visibility: meta.visibility,
    restrictions: meta.restrictions,
    approvalStatus: approvalStatus || 'approved',
  });
}

function stripExtension(name) {
  return name.replace(/\.[^/.]+$/, '');
}

// Course-scope guard for the direct-publish upload paths (uploadFiles /
// attachUploadcareFiles), shared by /files (admin-tier) and /faculty/files.
// The unrestricted 'admin' role and super_admin/administrator can upload to
// any department/course, as before. Faculty's existing behavior is left
// exactly as it was (out of scope here — see the flagged follow-up).
// A custom admin-tier Role (e.g. "CR") is new ground: previously completely
// unrestricted, now scoped to the same "reachable courses" rule Submit
// Material already enforces (own department's courses, plus any course held
// via an active/approved CourseEnrollment) — closing a real gap where a CR
// with just the 'files' permission could otherwise publish into any course
// in the university by simply typing a different department/course id.
export async function assertUploadScope(user, meta) {
  if (user.role === 'admin' || isSuperAdminTier(user.role) || user.role === 'faculty') return;

  const effectiveCourseIds = await getEffectiveCourseIds(user);
  if (!effectiveCourseIds.includes(String(meta.course._id))) {
    throw new ApiError(403, 'You can only upload to a course in your own department or one you are enrolled in', null, 'FORBIDDEN');
  }
}

// Accepts one or more files (req.files) uploaded together under one shared
// title and metadata (department/course/batch/category/etc). All of them
// become a single File document — its `attachments` array holds each
// physical file, so the entry shows up once in search/listings under one
// title instead of once per uploaded file.
export const uploadFiles = asyncHandler(async (req, res) => {
  const files = req.files && req.files.length ? req.files : req.file ? [req.file] : [];
  const isExternal = req.body.uploadType === 'external';

  const { title, description, semester, academicYear } = req.body;
  const meta = await resolveUploadMetadata(req.body);
  await assertUploadScope(req.user, meta);
  assertSemesterMatchesCourse(meta.course, semester);

  // An external-link material has no uploaded bytes — the URL is the material.
  // A file upload still requires at least one file, exactly as before.
  let externalUrl = '';
  if (isExternal) {
    externalUrl = typeof req.body.externalUrl === 'string' ? req.body.externalUrl.trim() : '';
    if (!isValidHttpsUrl(externalUrl)) {
      throw new ApiError(400, 'The external link must be a valid https:// URL');
    }
    const { attachments } = buildExternalSubmission(externalUrl, title);
    const file = await createGroupedFile({
      attachments,
      title,
      description,
      semester,
      academicYear,
      meta,
      uploadedBy: req.user._id,
      uploadType: 'external',
      externalUrl,
    });
    notifyCourseMaterial(file, req.user, 'COURSE_MATERIAL');
    return res.status(201).json({ success: true, data: file });
  }

  if (!files.length) throw new ApiError(400, 'At least one file is required');

  const attachments = [];
  const failed = [];

  for (const uploadedFile of files) {
    try {
      const stored = await storeUploadedFileFromPath(uploadedFile.path, uploadedFile.originalname, uploadedFile.mimetype, {
        purpose: 'academic-material',
        ownerId: String(req.user._id),
        size: uploadedFile.size,
      });
      await fs.rm(uploadedFile.path, { force: true }).catch(() => null);
      attachments.push({
        originalName: uploadedFile.originalname,
        fileName: stored.fileName,
        fileType: stored.fileType,
        mimeType: uploadedFile.mimetype,
        fileSize: uploadedFile.size,
        fileUrl: stored.fileUrl,
        storageProvider: stored.storageProvider,
        storageRef: stored.storageRef,
      });
    } catch (err) {
      failed.push({ fileName: uploadedFile.originalname, message: err.message });
    }
  }

  if (!attachments.length) {
    throw new ApiError(502, 'All uploads failed', failed);
  }

  const file = await createGroupedFile({
    attachments,
    title,
    description,
    semester,
    academicYear,
    meta,
    uploadedBy: req.user._id,
  });

  // Optimize what was just stored — off the request path, and never able to fail
  // it. The material above is already complete and points at the original, so
  // this only ever makes it smaller.
  queueMaterialOptimization(file).catch((err) =>
    logger.error(err, { req, source: 'fileController.uploadFiles', meta: { action: 'OPTIMIZE_QUEUE_FAILED', targetId: file._id } })
  );

  notifyCourseMaterial(file, req.user, 'COURSE_MATERIAL');
  res.status(201).json({ success: true, data: file, failed: failed.length ? failed : undefined });
});

// Records files that were already uploaded directly from the browser to
// Uploadcare's CDN (via their File Uploader widget) — our server never
// touches the binary, only the resulting metadata. Body: { title?,
// description?, semester?, academicYear?, departmentId, courseIdRef,
// categoryId, batches?, allBatches?, keywords?, files: [{ uuid, name,
// size, mimeType, isImage }] } — matching Uploadcare's OutputFileEntry
// shape (successEntries from the onCommonUploadSuccess event).
export const attachUploadcareFiles = asyncHandler(async (req, res) => {
  const { files, title, description, semester, academicYear } = req.body;
  if (!Array.isArray(files) || !files.length) {
    throw new ApiError(400, 'At least one uploaded file descriptor is required');
  }

  const meta = await resolveUploadMetadata(req.body);
  await assertUploadScope(req.user, meta);
  assertSemesterMatchesCourse(meta.course, semester);

  const attachments = files.map((f) => {
    if (!f.uuid) throw new ApiError(400, 'Each file needs an Uploadcare uuid');
    const mimeType = f.mimeType || 'application/octet-stream';
    const name = f.name || f.uuid;
    const { fileType } = f.isImage ? { fileType: 'image' } : resolveDocumentType(mimeType, name);

    return {
      originalName: name,
      fileName: name,
      fileType,
      mimeType,
      fileSize: Number(f.size) || 0,
      fileUrl: uploadcareCdnUrl(f.uuid),
      storageProvider: 'uploadcare',
      storageRef: f.uuid,
    };
  });

  const file = await createGroupedFile({
    attachments,
    title,
    description,
    semester,
    academicYear,
    meta,
    uploadedBy: req.user._id,
  });

  notifyCourseMaterial(file, req.user, 'COURSE_MATERIAL');
  res.status(201).json({ success: true, data: file });
});

// POST /files/submit — a Student's (or a "CR"-tier admin account's) own
// material submission. Always lands as approvalStatus:'pending' with a safe
// default visibility/no restrictions, regardless of anything the client
// sends for those fields — that decision belongs to the reviewer at approval
// time, not the submitter. The submitter may only pick a course they can
// actually reach — their own department's courses, plus any course they
// hold an active/approved CourseEnrollment for (see courseAccessService.js,
// the same rule GET /courses/mine uses to populate the form's dropdown) —
// checked here server-side since the client's course list is only a UX
// convenience, never the enforcement point.
export const submitStudentFile = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  if (!settings.studentUploadEnabled) {
    throw new ApiError(400, 'Student material uploads are currently disabled');
  }

  // A pending/rejected student can't submit material either — Submit
  // Material is login-required like everything else gated by
  // isBlockedByApproval (Files, Assignments, Quizzes, Messaging).
  if (await isBlockedByApproval(req.user)) {
    throw new ApiError(403, 'Your account is pending admin approval', null, 'FORBIDDEN');
  }

  const files = req.files && req.files.length ? req.files : req.file ? [req.file] : [];
  const isExternal = req.body.uploadType === 'external';

  const { title, description, academicYear } = req.body;
  const meta = await resolveUploadMetadata(req.body);

  const effectiveCourseIds = await getEffectiveCourseIds(req.user);
  if (!effectiveCourseIds.includes(String(meta.course._id))) {
    throw new ApiError(403, 'You can only submit material for a course in your own department or one you are enrolled in', null, 'FORBIDDEN');
  }

  // The batch and the semester are the SUBMITTER's own, derived from their
  // profile — so `batch`/`semester` in the request body are ignored here, and
  // both clients have stopped sending them. See resolveSubmitterScope.
  //
  // assertSemesterMatchesCourse is deliberately NOT applied to the derived
  // semester. It exists to catch a client choosing a semester that contradicts
  // the course, and there is no choice here to get wrong — whereas applying it
  // would block a student enrolled in a course from another semester (an
  // approved retake) outright, even though the reachability check above has just
  // established that they may submit to it.
  const scope = await resolveSubmitterScope(req.user, meta.course);
  meta.batches = scope.batchIds;
  meta.batchCodes = scope.batchCodes;
  meta.allBatches = scope.allBatches;
  const semester = scope.semester;

  // The submitter now chooses the access setting (Public / Login Required), so
  // it is honoured here rather than forced — but the submission still lands
  // approvalStatus:'pending', so a reviewer still gates when it becomes visible.
  // Fine-grained restrictions stay the reviewer's decision.
  //
  // The optional batch the submitter picked is targeting only — a grouping and
  // filter axis, never a permission (that is what `restrictions` above is, and
  // it stays empty here). resolveUploadMetadata has already validated it
  // against this course's department, so anything that survived that check is
  // safe to keep. No batch picked is the common case: the metadata then carries
  // the empty `batches`/`batchCodes` and false `allBatches` it always did.
  meta.visibility = req.body.visibility === 'public' ? 'public' : 'login_required';
  meta.restrictions = { departments: [], batches: [], semesters: [], courses: [] };

  if (isExternal) {
    const externalUrl = typeof req.body.externalUrl === 'string' ? req.body.externalUrl.trim() : '';
    if (!isValidHttpsUrl(externalUrl)) {
      throw new ApiError(400, 'The external link must be a valid https:// URL');
    }
    const { attachments } = buildExternalSubmission(externalUrl, title);
    const file = await createGroupedFile({
      attachments,
      title,
      description,
      semester,
      academicYear,
      meta,
      uploadedBy: req.user._id,
      approvalStatus: 'pending',
      uploadType: 'external',
      externalUrl,
    });
    notifyReviewRequest(file, req.user);
    return res.status(201).json({
      success: true,
      message: 'Submitted — pending review before it becomes available',
      data: file,
    });
  }

  if (!files.length) throw new ApiError(400, 'At least one file is required');

  const attachments = [];
  const failed = [];
  for (const uploadedFile of files) {
    try {
      const stored = await storeUploadedFileFromPath(uploadedFile.path, uploadedFile.originalname, uploadedFile.mimetype, {
        purpose: 'academic-material',
        ownerId: String(req.user._id),
        size: uploadedFile.size,
      });
      await fs.rm(uploadedFile.path, { force: true }).catch(() => null);
      attachments.push({
        originalName: uploadedFile.originalname,
        fileName: stored.fileName,
        fileType: stored.fileType,
        mimeType: uploadedFile.mimetype,
        fileSize: uploadedFile.size,
        fileUrl: stored.fileUrl,
        storageProvider: stored.storageProvider,
        storageRef: stored.storageRef,
      });
    } catch (err) {
      failed.push({ fileName: uploadedFile.originalname, message: err.message });
    }
  }
  if (!attachments.length) throw new ApiError(502, 'All uploads failed', failed);

  const file = await createGroupedFile({
    attachments,
    title,
    description,
    semester,
    academicYear,
    meta,
    uploadedBy: req.user._id,
    approvalStatus: 'pending',
  });

  // Same as the staff path: the submission is saved and reviewable as-is, and
  // optimizing its files happens afterwards.
  queueMaterialOptimization(file).catch((err) =>
    logger.error(err, { req, source: 'fileController.submitStudentFile', meta: { action: 'OPTIMIZE_QUEUE_FAILED', targetId: file._id } })
  );

  notifyReviewRequest(file, req.user);

  res.status(201).json({
    success: true,
    message: 'Submitted — pending review before it becomes available',
    data: file,
    failed: failed.length ? failed : undefined,
  });
});

// GET /files/mine — any authenticated user's own uploads/submissions,
// including pending ones (unlike every other listing path). Used by
// students to track their submission status.
export const getMySubmittedFiles = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { uploadedBy: req.user._id };

  const [files, total] = await Promise.all([
    File.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    File.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: files,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// Same typo-tolerant fuzzy engine as GET /search and Question Bank search
// (server/src/utils/textSearch.js) — a short/absent `q` keeps the original
// fast DB-only path so every non-search caller (plain browsing/filtering)
// is completely unaffected.
export const listFiles = asyncHandler(async (req, res) => {
  const { sort, q } = req.query;
  const { page, limit, skip } = parsePagination(req.query);
  const cleanQuery = sanitizeQuery(q);
  const accessCtx = await buildAccessContext(req.user);

  if (!q || cleanQuery.length < 2) {
    const query = await buildFileQuery(req.query, req.user, { includeLocked: true, accessCtx });
    const [files, total] = await Promise.all([
      File.find(query, lockProjection()).sort(buildSortOption(sort, false)).skip(skip).limit(limit),
      File.countDocuments(query),
    ]);
    return res.json({
      success: true,
      data: attachFileLocks(files, accessCtx),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  }

  const { ranked, queryTokens, candidates } = await fuzzyRankFiles(req.query, req.user, q, { includeLocked: true, accessCtx });
  const total = ranked.length;
  const start = (page - 1) * limit;
  const pageItems = ranked.slice(start, start + limit);

  const data = attachFileLocks(
    pageItems.map(({ file }) => file),
    accessCtx
  ).map((obj, i) => ({ ...obj, score: pageItems[i].score, matchType: pageItems[i].matchType }));

  const suggestion = suggestFileCorrection(queryTokens, candidates, pageItems[0]?.matchType || 'none');

  res.json({
    success: true,
    data,
    correctedQuery: suggestion || undefined,
    suggestion: suggestion || undefined,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getFile = asyncHandler(async (req, res) => {
  const existing = await File.findById(req.params.id);
  if (!existing) throw new ApiError(404, 'File not found');
  if (!(await userCanAccessFile(existing, req.user))) {
    throw new ApiError(403, 'You do not have access to this material', null, 'FORBIDDEN');
  }

  const file = await File.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true })
    .populate('department', 'name code')
    .populate('course', 'name courseId')
    .populate('category', 'name');
  res.json({ success: true, data: file });
});

// GET /files/:id/preview[?attachment=<id>] — streams the raw file bytes
// through this server instead of the browser fetching the storage
// provider's URL (R2/S3) directly. PdfViewer's client-side renderer (pdf.js)
// fetches its `file` prop with XHR/fetch, which enforces CORS — and this
// app's storage buckets don't (and needn't) send CORS headers for a URL
// that's otherwise only ever used in a plain `<a href>`/`<img>`/download, so
// a direct R2 URL reliably fails there with "blocked by CORS policy". This
// endpoint re-serves those same bytes from this app's own origin, which
// pdf.js's fetch is always allowed to read — same access check as getFile,
// so this is never a way to reach a file the caller couldn't already GET.
export const streamFilePreview = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id);
  if (!file) throw new ApiError(404, 'File not found');
  if (!(await userCanAccessFile(file, req.user))) {
    throw new ApiError(403, 'You do not have access to this material', null, 'FORBIDDEN');
  }

  const { attachment: attachmentId } = req.query;
  const target = attachmentId ? file.attachments?.find((a) => String(a._id) === String(attachmentId)) : file;
  if (!target?.fileUrl) throw new ApiError(404, 'File not found');

  const sourceUrl = target.fileUrl.startsWith('http') ? target.fileUrl : `${req.protocol}://${req.get('host')}${target.fileUrl}`;

  let upstream;
  try {
    upstream = await fetch(sourceUrl);
  } catch (err) {
    logger.error(err, { req, source: 'streamFilePreview', meta: { fileId: file._id, sourceUrl } });
    throw new ApiError(502, 'Failed to fetch the source file');
  }
  // A 404 here means the underlying object is gone from storage (deleted or
  // expired at the provider — e.g. an Uploadcare-attached file whose CDN
  // entry has since expired) even though the File document itself still
  // exists — distinct from a transient fetch failure, so it gets its own
  // message rather than the generic "failed to fetch" one.
  if (upstream.status === 404) {
    throw new ApiError(404, "This file's content is no longer available at its storage location");
  }
  if (!upstream.ok || !upstream.body) {
    logger.warn(`Preview upstream fetch returned ${upstream.status}`, { req, source: 'streamFilePreview', meta: { fileId: file._id, sourceUrl, status: upstream.status } });
    throw new ApiError(502, 'Failed to fetch the source file');
  }

  res.setHeader('Content-Type', target.mimeType || upstream.headers.get('content-type') || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, max-age=300');
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) res.setHeader('Content-Length', contentLength);

  Readable.fromWeb(upstream.body).pipe(res);
});

export const recordDownload = asyncHandler(async (req, res) => {
  const existing = await File.findById(req.params.id);
  if (!existing) throw new ApiError(404, 'File not found');
  if (!(await userCanAccessFile(existing, req.user))) {
    throw new ApiError(403, 'You do not have access to this material', null, 'FORBIDDEN');
  }

  const file = await File.findByIdAndUpdate(req.params.id, { $inc: { downloads: 1 } }, { new: true });
  res.json({ success: true, data: { fileUrl: file.fileUrl, originalName: file.originalName } });
});

export const getRelatedFiles = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id);
  if (!file) throw new ApiError(404, 'File not found');

  const accessCtx = await buildAccessContext(req.user);
  const accessFilter = await buildFileQuery({}, req.user, { includeLocked: true, accessCtx });
  const related = await File.find({
    ...accessFilter,
    _id: { $ne: file._id },
    course: file.course,
  })
    .select(LOCK_SELECT)
    .sort({ createdAt: -1 })
    .limit(8);

  res.json({ success: true, data: attachFileLocks(related, accessCtx) });
});

// Admins may only manage files they themselves uploaded; Super Admin bypasses
// this check entirely, and a Faculty member may manage any file within their
// assigned Department(s)/Course(s). Checked against the document fetched
// from the database — never against anything the client claims.
export function assertOwnership(file, user) {
  if (user.role === 'super_admin' || user.role === 'administrator') return;
  if (user.role === 'faculty' && isFacultyScopedToFile(user, file)) return;
  if (!file.uploadedBy.equals(user._id)) {
    throw new ApiError(403, 'You can only manage files you uploaded', null, 'FORBIDDEN');
  }
}

// Whether the caller may use the full file editor. Everyone else who can reach
// updateFile is the uploader acting as a student, and is limited to describing
// their own upload — see updateFile.
export async function hasFullFileEdit(user) {
  if (isSuperAdminTier(user)) return true;
  if (user.role === 'faculty') return true;
  const role = await getRole(user.role);
  return Boolean(role && role.permissions.includes('files'));
}

export const updateFile = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id);
  if (!file) throw new ApiError(404, 'File not found');
  assertOwnership(file, req.user); // own-files-only unless super_admin — same gate covers visibility/restrictions

  // The uploader acting as a student may edit what describes their upload, plus
  // its access setting (Public / Login Required). Fine-grained restrictions,
  // status and the chapter/topic placement remain the reviewer's decision at
  // approval time (submitStudentFile does not accept them either) — allowing
  // those here would let a submitter publish their own material without review.
  const fullEdit = await hasFullFileEdit(req.user);

  const allowed = fullEdit
    ? ['title', 'description', 'semester', 'academicYear', 'status']
    : ['title', 'description'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) file[key] = req.body[key];
  }
  if (req.body.keywords) {
    file.keywords = String(req.body.keywords).split(',').map((k) => k.trim()).filter(Boolean);
  }

  if (req.body.visibility) {
    // The access setting (Public / Login Required) belongs to the material's
    // owner as much as to a reviewer — a submitter picks it at upload time and
    // may correct it on their own item. Fine-grained restrictions and `status`
    // stay staff-only (see `allowed` above), so this is not a way to widen
    // access to specific people.
    if (!['public', 'login_required'].includes(req.body.visibility)) {
      throw new ApiError(400, 'visibility must be "public" or "login_required"');
    }
    file.visibility = req.body.visibility;
  }

  if (fullEdit && req.body.restrictions && typeof req.body.restrictions === 'object') {
    const r = req.body.restrictions;
    file.restrictions = {
      departments: Array.isArray(r.departments) ? r.departments : file.restrictions?.departments || [],
      batches: Array.isArray(r.batches) ? r.batches : file.restrictions?.batches || [],
      semesters: Array.isArray(r.semesters) ? r.semesters : file.restrictions?.semesters || [],
      courses: Array.isArray(r.courses) ? r.courses : file.restrictions?.courses || [],
    };
  }

  if (fullEdit && req.body.chapterId !== undefined) {
    const chapter = req.body.chapterId ? await Chapter.findById(req.body.chapterId) : null;
    if (req.body.chapterId && !chapter) throw new ApiError(400, 'Invalid chapter');
    file.chapter = chapter?._id || null;
    file.chapterName = chapter?.name || '';
  }
  if (fullEdit && req.body.topicId !== undefined) {
    const topic = req.body.topicId ? await Topic.findById(req.body.topicId) : null;
    if (req.body.topicId && !topic) throw new ApiError(400, 'Invalid topic');
    file.topic = topic?._id || null;
    file.topicName = topic?.name || '';
  }

  await file.save();

  res.json({ success: true, data: file });
});

// POST /admin/files/:id/versions — replaces the current attachment(s) with
// a newly-uploaded set, pushing the outgoing ones into `versions[]` history.
export const replaceFileVersion = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id);
  if (!file) throw new ApiError(404, 'File not found');
  assertOwnership(file, req.user);

  const files = req.files && req.files.length ? req.files : req.file ? [req.file] : [];
  if (!files.length) throw new ApiError(400, 'At least one replacement file is required');

  const attachments = [];
  const failed = [];
  for (const uploadedFile of files) {
    try {
      const stored = await storeUploadedFileFromPath(uploadedFile.path, uploadedFile.originalname, uploadedFile.mimetype, {
        purpose: 'academic-material',
        ownerId: String(req.user._id),
        size: uploadedFile.size,
      });
      await fs.rm(uploadedFile.path, { force: true }).catch(() => null);
      attachments.push({
        originalName: uploadedFile.originalname,
        fileName: stored.fileName,
        fileType: stored.fileType,
        mimeType: uploadedFile.mimetype,
        fileSize: uploadedFile.size,
        fileUrl: stored.fileUrl,
        storageProvider: stored.storageProvider,
        storageRef: stored.storageRef,
      });
    } catch (err) {
      failed.push({ fileName: uploadedFile.originalname, message: err.message });
    }
  }
  if (!attachments.length) throw new ApiError(502, 'All uploads failed', failed);

  // Snapshot exactly which objects are being superseded before touching the
  // document — deletion below (after save succeeds) targets only these
  // specific storageRefs, never anything derived after the fact, so a
  // concurrent replace on a different file can't have its objects deleted.
  const outgoingAttachments = file.attachments;

  file.versions.push({
    attachments: outgoingAttachments,
    title: file.title,
    description: file.description,
    fileSize: file.fileSize,
    versionNumber: file.currentVersion,
    replacedBy: req.user._id,
    replacedAt: new Date(),
  });

  const primary = attachments[0];
  const totalSize = attachments.reduce((sum, a) => sum + a.fileSize, 0);
  file.attachments = attachments;
  file.fileCount = attachments.length;
  file.originalName = primary.originalName;
  file.fileName = primary.fileName;
  file.fileType = primary.fileType;
  file.mimeType = primary.mimeType;
  file.fileSize = totalSize;
  file.fileUrl = primary.fileUrl;
  file.storageProvider = primary.storageProvider;
  file.storageRef = primary.storageRef;
  file.currentVersion += 1;

  try {
    await file.save();
  } catch (err) {
    // The new file(s) uploaded successfully but the database update failed —
    // clean up the orphan(s) we just created rather than leaving them
    // unreferenced in storage. The document was never mutated in the DB (the
    // save() that would have persisted `file.attachments` above never
    // completed), so the old file/version history remains exactly as it was.
    await Promise.all(attachments.map((a) => deleteStoredFile(a).catch(() => null)));
    throw err;
  }

  // Only now — after the database durably points at the new attachments —
  // remove the superseded ones from storage. Best-effort: a deletion
  // failure here must not undo an already-successful replace; it's logged
  // and the new file stays active (see spec's "do not roll back on cleanup
  // failure" rule).
  Promise.all(outgoingAttachments.map((a) => deleteStoredFile(a).catch((err) => {
    logger.error(err, { req, source: 'fileController.replaceFileVersion', meta: { action: 'FILE_CLEANUP_FAILED', targetId: file._id, storageRef: a.storageRef } });
  }))).then(() => {
    logger.info('Old material file version deleted', { req, source: 'fileController.replaceFileVersion', meta: { action: 'OLD_FILE_DELETED', targetId: file._id } });
  });

  // A replaced version is a new physical file, so it is optimized exactly like a
  // fresh upload.
  queueMaterialOptimization(file, { ownerId: req.user._id }).catch((err) =>
    logger.error(err, { req, source: 'fileController.replaceFileVersion', meta: { action: 'OPTIMIZE_QUEUE_FAILED', targetId: file._id } })
  );

  notifyCourseMaterial(file, req.user, 'FILE_UPDATED');
  res.status(201).json({ success: true, message: 'New version uploaded', data: file, failed: failed.length ? failed : undefined });
});

export const getFileVersions = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id).select('versions currentVersion uploadedBy department course');
  if (!file) throw new ApiError(404, 'File not found');
  assertOwnership(file, req.user);
  res.json({ success: true, data: { versions: file.versions, currentVersion: file.currentVersion } });
});

/**
 * Removes the optimization records belonging to attachments that are being
 * deleted, along with the thumbnail/preview objects they generated.
 *
 * <p>Without this, deleting a material would leave its StoredFile rows behind:
 * counted forever in the storage dashboard, and claiming a COMPLETED
 * optimization for an object that no longer exists.
 *
 * <p>Best-effort on purpose — bookkeeping must never be the reason a delete
 * fails. The material's own object is removed by the caller; this only clears up
 * what the pipeline added around it.
 */
async function forgetStoredFiles(attachments) {
  const ids = attachments.map((a) => a.storedFileId).filter(Boolean);
  if (!ids.length) return;

  try {
    const records = await StoredFile.find({ _id: { $in: ids } }).select('storageProvider derivatives');

    const derivatives = [];
    for (const record of records) {
      for (const name of ['thumbnail', 'preview']) {
        const key = record.derivatives?.[name]?.key;
        if (key) derivatives.push({ storageProvider: record.storageProvider, storageRef: key });
      }
    }
    await Promise.all(derivatives.map((target) => deleteStoredFile(target).catch(() => null)));

    await StoredFile.deleteMany({ _id: { $in: ids } });
  } catch (err) {
    logger.warn(`[uploads] could not clear the optimization record(s) for a deleted material: ${err.message}`, {
      source: 'fileController.forgetStoredFiles',
    });
  }
}

export async function deleteAllAttachments(file) {
  const attachments = file.attachments?.length ? file.attachments : [file];
  await Promise.all(attachments.map((a) => deleteStoredFile(a).catch(() => null)));
  await forgetStoredFiles(attachments);
}

// The delete flow's storage step: throws if ANY stored object could not be
// removed, so the caller can leave the database record in place to be retried.
// An external-link material (or anything with no storageRef) is a no-op — it has
// no object to remove — so it always succeeds here.
export async function deleteAllAttachmentsStrict(file) {
  const attachments = file.attachments?.length ? file.attachments : [file];
  await Promise.all(attachments.map((a) => deleteStoredFileStrict(a)));
  await forgetStoredFiles(attachments);
}

// Removes a material completely: its stored object(s), the document, and the
// references to it (bookmarks). Authorization is assertOwnership — the real
// gate — so a Student/CR may delete their own upload, Faculty their own/scoped
// material, and the super-admin tier anything. Storage goes FIRST: if it fails,
// the document is kept so the delete can be retried rather than leaving an
// orphaned object nothing points at.
export async function deleteFileRecord(file) {
  try {
    await deleteAllAttachmentsStrict(file);
  } catch (err) {
    logger.error(err, {
      source: 'fileController.deleteFileRecord',
      meta: { action: 'FILE_DELETE_STORAGE_FAILED', targetId: file._id },
    });
    throw new ApiError(502, 'The stored file could not be removed, so nothing was deleted. Please retry.');
  }
  await Bookmark.deleteMany({ file: file._id });
  await file.deleteOne();
}

export const deleteFile = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id);
  if (!file) throw new ApiError(404, 'File not found');
  assertOwnership(file, req.user);

  await deleteFileRecord(file);

  res.json({ success: true, message: 'File deleted' });
});

export const bulkDeleteFiles = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'ids array is required');

  const files = await File.find({ _id: { $in: ids } });
  for (const f of files) assertOwnership(f, req.user);

  for (const f of files) {
    await deleteFileRecord(f);
  }

  res.json({ success: true, message: `${files.length} file(s) deleted` });
});

// GET /api/admin/files — an Admin's (or Super Admin's) own uploads only.
// The filter is applied server-side, never left to the frontend to hide.
export const getMyFiles = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { uploadedBy: req.user._id };
  const cleanQuery = sanitizeQuery(q);

  if (q && cleanQuery.length >= 2) {
    return respondWithFuzzyFiles(res, filter, q, page, limit);
  }

  const [files, total] = await Promise.all([
    File.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    File.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: files,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// GET /faculty/files — the material a Faculty member themselves uploaded within
// their assigned Department(s)/Course(s). Pending items live in the separate
// /reviews queue, not here.
//
// OWNERSHIP is enforced here, not by the caller: access to a course is not
// ownership of its content, so a faculty member must never be handed a
// colleague's material just because they both teach the same course. This
// deliberately does not depend on a client-supplied flag — the clients used to
// send `?mine=true`, and anything that forgot to could read every colleague's
// uploads. `mine` is still accepted and ignored, so an older client keeps
// working against this build.
//
// There is no sharing model for files (no per-record allow-list), so nothing is
// merged back in. If explicit cross-faculty sharing is ever added, it belongs
// here as an OR alongside the ownership clause.
export const getFacultyScopedFiles = asyncHandler(async (req, res) => {
  const { q, course, batch } = req.query;
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {
    approvalStatus: 'approved',
    uploadedBy: req.user._id,
    $or: [
      { department: { $in: req.user.assignedDepartments || [] } },
      { course: { $in: req.user.assignedCourses || [] } },
    ],
  };
  // Course page → the Files tab, scoped to one course and optionally one batch.
  // The batch clause also accepts "applies to all batches", which is what a
  // student viewing that batch would see (same rule as fileQueryBuilder).
  if (course) filter.course = course;
  if (batch) filter.$and = [{ $or: [{ batches: batch }, { allBatches: true }] }];
  const cleanQuery = sanitizeQuery(q);

  if (q && cleanQuery.length >= 2) {
    return respondWithFuzzyFiles(res, filter, q, page, limit);
  }

  const [files, total] = await Promise.all([
    File.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    File.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: files,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getRecentFiles = asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 8;
  const accessCtx = await buildAccessContext(req.user);
  const query = await buildFileQuery({}, req.user, { includeLocked: true, accessCtx });
  const files = await File.find(query).select(LOCK_SELECT).sort({ createdAt: -1 }).limit(limit);
  res.json({ success: true, data: attachFileLocks(files, accessCtx) });
});

export const getPopularFiles = asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 8;
  const accessCtx = await buildAccessContext(req.user);
  const query = await buildFileQuery({}, req.user, { includeLocked: true, accessCtx });
  const files = await File.find(query).select(LOCK_SELECT).sort({ views: -1, downloads: -1 }).limit(limit);
  res.json({ success: true, data: attachFileLocks(files, accessCtx) });
});

// GET /files/dashboard — personalized landing sections for a signed-in
// student: Recommended (own department/batch/semester, access-filtered),
// Recent (reuses the same scoped query — there's no per-user view-history
// collection yet, so this is department/batch-recent rather than
// personally-viewed-recent), and Bookmarked (existing Bookmark collection).
export const getDashboard = asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 8;
  const accessCtx = await buildAccessContext(req.user);
  const baseQuery = await buildFileQuery({}, req.user, { includeLocked: true, accessCtx });

  const recommendedQuery = { ...baseQuery };
  if (req.user?.department) recommendedQuery.department = req.user.department;

  const [recommended, recent, bookmarks] = await Promise.all([
    File.find(recommendedQuery).select(LOCK_SELECT).sort({ createdAt: -1 }).limit(limit),
    File.find(baseQuery).select(LOCK_SELECT).sort({ createdAt: -1 }).limit(limit),
    req.user
      ? Bookmark.find({ user: req.user._id }).populate({ path: 'file', select: LIST_SELECT }).sort({ createdAt: -1 }).limit(limit)
      : Promise.resolve([]),
  ]);

  res.json({
    success: true,
    data: {
      recommended: attachFileLocks(recommended, accessCtx),
      recent: attachFileLocks(recent, accessCtx),
      // A user's own bookmarks are, by definition, files they can already see.
      bookmarked: bookmarks.filter((b) => b.file).map((b) => b.file),
    },
  });
});

export const getStats = asyncHandler(async (req, res) => {
  const [departments, courses, batches, files] = await Promise.all([
    Department.countDocuments({ status: 'active' }),
    Course.countDocuments({ status: 'active' }),
    Batch.countDocuments({ status: 'active' }),
    File.countDocuments({ status: 'active' }),
  ]);
  res.json({ success: true, data: { departments, courses, batches, files } });
});
