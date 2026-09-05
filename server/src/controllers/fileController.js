import File from '../models/File.js';
import Department from '../models/Department.js';
import Course from '../models/Course.js';
import Batch from '../models/Batch.js';
import Category from '../models/Category.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { storeUploadedFile, deleteStoredFile } from '../services/storage/storageService.js';
import { uploadcareCdnUrl } from '../services/storage/uploadcareStorage.js';
import { resolveDocumentType } from '../utils/fileTypes.js';
import { buildFileQuery, buildSortOption } from '../services/fileQueryBuilder.js';

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
  const { departmentId, courseIdRef, categoryId, keywords } = body;
  const batchIds = body.batches ? [].concat(body.batches) : [];
  const allBatches = body.allBatches === 'true' || body.allBatches === true;

  const [department, course, category] = await Promise.all([
    Department.findById(departmentId),
    Course.findById(courseIdRef),
    Category.findById(categoryId),
  ]);
  if (!department) throw new ApiError(400, 'Invalid department');
  if (!course) throw new ApiError(400, 'Invalid course');
  if (!category) throw new ApiError(400, 'Invalid category');

  let batches = [];
  let batchCodes = [];
  if (!allBatches && batchIds.length) {
    const found = await Batch.find({ _id: { $in: batchIds } });
    batchCodes = found.map((b) => b.code);
    batches = found.map((b) => b._id);
  }

  const keywordList = keywords ? String(keywords).split(',').map((k) => k.trim()).filter(Boolean) : [];

  return { department, course, category, batches, batchCodes, allBatches, keywordList };
}

// Creates one File entry (with an `attachments[]` of one or more physical
// files) from already-prepared attachment descriptors + shared metadata.
async function createGroupedFile({ attachments, title, description, semester, academicYear, meta, uploadedBy }) {
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
    description: description || '',
    keywords: meta.keywordList,
    uploadedBy,
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

export const listFiles = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, sort, q } = req.query;
  const query = buildFileQuery(req.query);

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
  const file = await File.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true })
    .populate('department', 'name code')
    .populate('course', 'name courseId')
    .populate('category', 'name');
  if (!file) throw new ApiError(404, 'File not found');
  res.json({ success: true, data: file });
});

export const recordDownload = asyncHandler(async (req, res) => {
  const file = await File.findByIdAndUpdate(req.params.id, { $inc: { downloads: 1 } }, { new: true });
  if (!file) throw new ApiError(404, 'File not found');
  res.json({ success: true, data: { fileUrl: file.fileUrl, originalName: file.originalName } });
});

export const getRelatedFiles = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id);
  if (!file) throw new ApiError(404, 'File not found');

  const related = await File.find({
    _id: { $ne: file._id },
    course: file.course,
  })
    .select(LIST_SELECT)
    .sort({ createdAt: -1 })
    .limit(8);

  res.json({ success: true, data: related });
});

export const updateFile = asyncHandler(async (req, res) => {
  const allowed = ['title', 'description', 'semester', 'academicYear', 'status'];
  const update = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) update[key] = req.body[key];
  }
  if (req.body.keywords) {
    update.keywords = String(req.body.keywords).split(',').map((k) => k.trim()).filter(Boolean);
  }

  const file = await File.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
  if (!file) throw new ApiError(404, 'File not found');
  res.json({ success: true, data: file });
});

async function deleteAllAttachments(file) {
  const attachments = file.attachments?.length ? file.attachments : [file];
  await Promise.all(attachments.map((a) => deleteStoredFile(a).catch(() => null)));
}

export const deleteFile = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id);
  if (!file) throw new ApiError(404, 'File not found');

  await deleteAllAttachments(file);
  await file.deleteOne();

  res.json({ success: true, message: 'File deleted' });
});

export const bulkDeleteFiles = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || !ids.length) throw new ApiError(400, 'ids array is required');

  const files = await File.find({ _id: { $in: ids } });
  await Promise.all(files.map((f) => deleteAllAttachments(f)));
  await File.deleteMany({ _id: { $in: ids } });

  res.json({ success: true, message: `${files.length} file(s) deleted` });
});

export const getRecentFiles = asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 8;
  const files = await File.find({ status: 'active' }).select(LIST_SELECT).sort({ createdAt: -1 }).limit(limit);
  res.json({ success: true, data: files });
});

export const getPopularFiles = asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 8;
  const files = await File.find({ status: 'active' })
    .select(LIST_SELECT)
    .sort({ views: -1, downloads: -1 })
    .limit(limit);
  res.json({ success: true, data: files });
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
