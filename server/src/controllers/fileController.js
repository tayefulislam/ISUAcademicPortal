import File from '../models/File.js';
import Department from '../models/Department.js';
import Course from '../models/Course.js';
import Batch from '../models/Batch.js';
import Category from '../models/Category.js';
import Chapter from '../models/Chapter.js';
import Topic from '../models/Topic.js';
import Bookmark from '../models/Bookmark.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { storeUploadedFile, deleteStoredFile } from '../services/storage/storageService.js';
import { uploadcareCdnUrl } from '../services/storage/uploadcareStorage.js';
import { resolveDocumentType } from '../utils/fileTypes.js';
import { buildFileQuery, buildSortOption, userCanAccessFile, isFacultyScopedToFile } from '../services/fileQueryBuilder.js';
import { getSettings } from '../models/Settings.js';

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

function listProjection(withScore) {
  const projection = Object.fromEntries(LIST_FIELDS.map((f) => [f, 1]));
  if (withScore) projection.score = { $meta: 'textScore' };
  return projection;
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

  let batches = [];
  let batchCodes = [];
  if (!allBatches && batchIds.length) {
    const found = await Batch.find({ _id: { $in: batchIds } });
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

// Creates one File entry (with an `attachments[]` of one or more physical
// files) from already-prepared attachment descriptors + shared metadata.
async function createGroupedFile({ attachments, title, description, semester, academicYear, meta, uploadedBy, approvalStatus }) {
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

// Accepts one or more files (req.files) uploaded together under one shared
// title and metadata (department/course/batch/category/etc). All of them
// become a single File document — its `attachments` array holds each
// physical file, so the entry shows up once in search/listings under one
// title instead of once per uploaded file.
export const uploadFiles = asyncHandler(async (req, res) => {
  const files = req.files && req.files.length ? req.files : req.file ? [req.file] : [];
  if (!files.length) throw new ApiError(400, 'At least one file is required');

  const { title, description, semester, academicYear } = req.body;
  const meta = await resolveUploadMetadata(req.body);

  const attachments = [];
  const failed = [];

  for (const uploadedFile of files) {
    try {
      const stored = await storeUploadedFile(uploadedFile.buffer, uploadedFile.originalname, uploadedFile.mimetype);
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

  res.status(201).json({ success: true, data: file });
});

// POST /files/submit — a student's own material submission. Always lands as
// approvalStatus:'pending' with a safe default visibility/no restrictions,
// regardless of anything the client sends for those fields — that decision
// belongs to the reviewer at approval time, not the submitter.
export const submitStudentFile = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  if (!settings.studentUploadEnabled) {
    throw new ApiError(400, 'Student material uploads are currently disabled');
  }

  const files = req.files && req.files.length ? req.files : req.file ? [req.file] : [];
  if (!files.length) throw new ApiError(400, 'At least one file is required');

  const { title, description } = req.body;
  const meta = await resolveUploadMetadata(req.body);
  meta.visibility = 'login_required';
  meta.restrictions = { departments: [], batches: [], semesters: [], courses: [] };
  meta.batches = [];
  meta.batchCodes = [];
  meta.allBatches = false;

  const attachments = [];
  const failed = [];
  for (const uploadedFile of files) {
    try {
      const stored = await storeUploadedFile(uploadedFile.buffer, uploadedFile.originalname, uploadedFile.mimetype);
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
    meta,
    uploadedBy: req.user._id,
    approvalStatus: 'pending',
  });

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
  const { page = 1, limit = 20 } = req.query;
  const filter = { uploadedBy: req.user._id };

  const skip = (Number(page) - 1) * Number(limit);
  const [files, total] = await Promise.all([
    File.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    File.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: files,
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  });
});

export const listFiles = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, sort, q } = req.query;
  const query = await buildFileQuery(req.query, req.user);

  const skip = (Number(page) - 1) * Number(limit);
  const [files, total] = await Promise.all([
    File.find(query, listProjection(Boolean(q)))
      .sort(buildSortOption(sort, q))
      .skip(skip)
      .limit(Number(limit)),
    File.countDocuments(query),
  ]);

  res.json({
    success: true,
    data: files,
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
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

  const accessFilter = await buildFileQuery({}, req.user);
  const related = await File.find({
    ...accessFilter,
    _id: { $ne: file._id },
    course: file.course,
  })
    .select(LIST_SELECT)
    .sort({ createdAt: -1 })
    .limit(8);

  res.json({ success: true, data: related });
});

// Admins may only manage files they themselves uploaded; Super Admin bypasses
// this check entirely, and a Faculty member may manage any file within their
// assigned Department(s)/Course(s). Checked against the document fetched
// from the database — never against anything the client claims.
export function assertOwnership(file, user) {
  if (user.role === 'super_admin') return;
  if (user.role === 'faculty' && isFacultyScopedToFile(user, file)) return;
  if (!file.uploadedBy.equals(user._id)) {
    throw new ApiError(403, 'You can only manage files you uploaded', null, 'FORBIDDEN');
  }
}

export const updateFile = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id);
  if (!file) throw new ApiError(404, 'File not found');
  assertOwnership(file, req.user); // own-files-only unless super_admin — same gate covers visibility/restrictions

  const allowed = ['title', 'description', 'semester', 'academicYear', 'status'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) file[key] = req.body[key];
  }
  if (req.body.keywords) {
    file.keywords = String(req.body.keywords).split(',').map((k) => k.trim()).filter(Boolean);
  }

  if (req.body.visibility) {
    if (!['public', 'login_required'].includes(req.body.visibility)) {
      throw new ApiError(400, 'visibility must be "public" or "login_required"');
    }
    file.visibility = req.body.visibility;
  }

  if (req.body.restrictions && typeof req.body.restrictions === 'object') {
    const r = req.body.restrictions;
    file.restrictions = {
      departments: Array.isArray(r.departments) ? r.departments : file.restrictions?.departments || [],
      batches: Array.isArray(r.batches) ? r.batches : file.restrictions?.batches || [],
      semesters: Array.isArray(r.semesters) ? r.semesters : file.restrictions?.semesters || [],
      courses: Array.isArray(r.courses) ? r.courses : file.restrictions?.courses || [],
    };
  }

  if (req.body.chapterId !== undefined) {
    const chapter = req.body.chapterId ? await Chapter.findById(req.body.chapterId) : null;
    if (req.body.chapterId && !chapter) throw new ApiError(400, 'Invalid chapter');
    file.chapter = chapter?._id || null;
    file.chapterName = chapter?.name || '';
  }
  if (req.body.topicId !== undefined) {
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
      const stored = await storeUploadedFile(uploadedFile.buffer, uploadedFile.originalname, uploadedFile.mimetype);
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

  file.versions.push({
    attachments: file.attachments,
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

  await file.save();

  res.status(201).json({ success: true, message: 'New version uploaded', data: file, failed: failed.length ? failed : undefined });
});

export const getFileVersions = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id).select('versions currentVersion uploadedBy department course');
  if (!file) throw new ApiError(404, 'File not found');
  assertOwnership(file, req.user);
  res.json({ success: true, data: { versions: file.versions, currentVersion: file.currentVersion } });
});

export async function deleteAllAttachments(file) {
  const attachments = file.attachments?.length ? file.attachments : [file];
  await Promise.all(attachments.map((a) => deleteStoredFile(a).catch(() => null)));
}

export const deleteFile = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id);
  if (!file) throw new ApiError(404, 'File not found');
  assertOwnership(file, req.user);

  await deleteAllAttachments(file);
  await file.deleteOne();

  res.json({ success: true, message: 'File deleted' });
});

export const bulkDeleteFiles = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'ids array is required');

  const files = await File.find({ _id: { $in: ids } });
  for (const f of files) assertOwnership(f, req.user);

  await Promise.all(files.map((f) => deleteAllAttachments(f)));
  await File.deleteMany({ _id: { $in: files.map((f) => f._id) } });

  res.json({ success: true, message: `${files.length} file(s) deleted` });
});

// GET /api/admin/files — an Admin's (or Super Admin's) own uploads only.
// The filter is applied server-side, never left to the frontend to hide.
export const getMyFiles = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, q } = req.query;
  const filter = { uploadedBy: req.user._id };
  if (q) filter.$text = { $search: q };

  const skip = (Number(page) - 1) * Number(limit);
  const [files, total] = await Promise.all([
    File.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    File.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: files,
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  });
});

// GET /faculty/files — approved materials within a Faculty member's assigned
// Department(s)/Course(s), for their "manage materials" view. Pending items
// live in the separate /reviews queue, not here.
export const getFacultyScopedFiles = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, q } = req.query;
  const filter = {
    approvalStatus: 'approved',
    $or: [
      { department: { $in: req.user.assignedDepartments || [] } },
      { course: { $in: req.user.assignedCourses || [] } },
    ],
  };
  if (q) filter.$text = { $search: q };

  const skip = (Number(page) - 1) * Number(limit);
  const [files, total] = await Promise.all([
    File.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    File.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: files,
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  });
});

export const getRecentFiles = asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 8;
  const query = await buildFileQuery({}, req.user);
  const files = await File.find(query).select(LIST_SELECT).sort({ createdAt: -1 }).limit(limit);
  res.json({ success: true, data: files });
});

export const getPopularFiles = asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 8;
  const query = await buildFileQuery({}, req.user);
  const files = await File.find(query).select(LIST_SELECT).sort({ views: -1, downloads: -1 }).limit(limit);
  res.json({ success: true, data: files });
});

// GET /files/dashboard — personalized landing sections for a signed-in
// student: Recommended (own department/batch/semester, access-filtered),
// Recent (reuses the same scoped query — there's no per-user view-history
// collection yet, so this is department/batch-recent rather than
// personally-viewed-recent), and Bookmarked (existing Bookmark collection).
export const getDashboard = asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 8;
  const baseQuery = await buildFileQuery({}, req.user);

  const recommendedQuery = { ...baseQuery };
  if (req.user?.department) recommendedQuery.department = req.user.department;

  const [recommended, recent, bookmarks] = await Promise.all([
    File.find(recommendedQuery).select(LIST_SELECT).sort({ createdAt: -1 }).limit(limit),
    File.find(baseQuery).select(LIST_SELECT).sort({ createdAt: -1 }).limit(limit),
    req.user
      ? Bookmark.find({ user: req.user._id }).populate({ path: 'file', select: LIST_SELECT }).sort({ createdAt: -1 }).limit(limit)
      : Promise.resolve([]),
  ]);

  res.json({
    success: true,
    data: {
      recommended,
      recent,
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
