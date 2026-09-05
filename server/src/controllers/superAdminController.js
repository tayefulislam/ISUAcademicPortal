import User from '../models/User.js';
import File from '../models/File.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { deleteStoredFile } from '../services/storage/storageService.js';

const POPULATE = [
  { path: 'department', select: 'name code' },
  { path: 'batch', select: 'name code' },
  { path: 'semester', select: 'name code' },
];

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ----- Users -----

export const listUsers = asyncHandler(async (req, res) => {
  const { q, name, email, rollNo, department, batch, semester, role, status, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (department) filter.department = department;
  if (batch) filter.batch = batch;
  if (semester) filter.semester = semester;
  if (role) filter.role = role;
  if (status) filter.status = status;
  if (name) filter.name = new RegExp(escapeRegex(name), 'i');
  if (email) filter.email = new RegExp(escapeRegex(email), 'i');
  if (rollNo) filter.rollNo = new RegExp(escapeRegex(rollNo), 'i');

  // Global search box: matches name, email, or roll number.
  if (q) {
    const re = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: re }, { email: re }, { rollNo: re }];
  }

  const skip = (Number(page) - 1) * Number(limit);
  const [users, total] = await Promise.all([
    User.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: users.map((u) => u.toSafeObject()),
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  });
});

export const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).populate(POPULATE);
  if (!user) throw new ApiError(404, 'User not found');
  res.json({ success: true, data: user.toSafeObject() });
});

// Promotes a student to admin, or demotes an admin back to student.
// Deliberately cannot target or assign 'super_admin' — that role is only
// ever set at the database level (seed script), never through this API,
// so a Super Admin account can't be created or escalated to by anyone
// operating through the app, including another Super Admin.
export const updateUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!['student', 'admin'].includes(role)) {
    throw new ApiError(400, 'Role must be "student" or "admin"');
  }

  const target = await User.findById(req.params.id);
  if (!target) throw new ApiError(404, 'User not found');
  if (target.role === 'super_admin') {
    throw new ApiError(403, 'Super Admin role cannot be changed through the API', null, 'FORBIDDEN');
  }
  if (target._id.equals(req.user._id)) {
    throw new ApiError(403, 'You cannot change your own role', null, 'FORBIDDEN');
  }

  target.role = role;
  target.tokenVersion += 1; // force re-login so the new role takes effect immediately
  await target.save();

  res.json({ success: true, message: `User role updated to ${role}`, data: target.toSafeObject() });
});

export const updateUserStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['active', 'blocked'].includes(status)) {
    throw new ApiError(400, 'Status must be "active" or "blocked"');
  }

  const target = await User.findById(req.params.id);
  if (!target) throw new ApiError(404, 'User not found');
  if (target.role === 'super_admin') {
    throw new ApiError(403, 'Super Admin accounts cannot be blocked', null, 'FORBIDDEN');
  }
  if (target._id.equals(req.user._id)) {
    throw new ApiError(403, 'You cannot block your own account', null, 'FORBIDDEN');
  }

  target.status = status;
  target.tokenVersion += 1; // immediately invalidate any tokens they're holding
  await target.save();

  res.json({ success: true, message: `User ${status === 'blocked' ? 'blocked' : 'unblocked'}`, data: target.toSafeObject() });
});

// ----- Files (system-wide) -----

const FILE_LIST_FIELDS =
  'title originalName fileType mimeType fileSize fileUrl fileCount departmentCode courseName courseId batchCodes allBatches semester academicYear categoryName views downloads uploadedBy status createdAt';

export const listAllFiles = asyncHandler(async (req, res) => {
  const { q, department, course, uploadedBy, page = 1, limit = 20 } = req.query;

  const filter = {};
  if (department) filter.department = department;
  if (course) filter.course = course;
  if (uploadedBy) filter.uploadedBy = uploadedBy;
  if (q) filter.$text = { $search: q };

  const skip = (Number(page) - 1) * Number(limit);
  const [files, total] = await Promise.all([
    File.find(filter)
      .select(FILE_LIST_FIELDS)
      .populate('uploadedBy', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    File.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: files,
    pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) },
  });
});

export const getAnyFile = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id)
    .populate('department', 'name code')
    .populate('course', 'name courseId')
    .populate('category', 'name')
    .populate('uploadedBy', 'name email role');
  if (!file) throw new ApiError(404, 'File not found');
  res.json({ success: true, data: file });
});

export const deleteAnyFile = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id);
  if (!file) throw new ApiError(404, 'File not found');

  const attachments = file.attachments?.length ? file.attachments : [file];
  await Promise.all(attachments.map((a) => deleteStoredFile(a).catch(() => null)));
  await file.deleteOne();

  res.json({ success: true, message: 'File deleted' });
});
