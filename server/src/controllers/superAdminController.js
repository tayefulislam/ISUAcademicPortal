import User from '../models/User.js';
import File from '../models/File.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { deleteStoredFile } from '../services/storage/storageService.js';
import { getSettings, updateSettings, FEATURE_FLAGS, NUMERIC_SETTINGS } from '../models/Settings.js';
import { roleExists } from '../models/Role.js';
import { rankFileCandidates } from '../services/fuzzyFileSearch.js';
import { sanitizeQuery } from '../utils/textSearch.js';
import { parsePagination } from '../utils/pagination.js';

// 'administrator' has every super_admin capability except visibility/control
// over super_admin accounts themselves, and only an actual super_admin can
// grant or revoke the 'administrator' role — see each guard below.
function isRealSuperAdmin(user) {
  return user.role === 'super_admin';
}

// ----- System settings / Feature Management -----
//
// Generic over FEATURE_FLAGS + NUMERIC_SETTINGS (models/Settings.js) so a
// new toggle/limit is just a new entry there — no controller change needed.

function flagsPayload(settings) {
  return {
    ...Object.fromEntries(FEATURE_FLAGS.map((f) => [f.key, !!settings[f.key]])),
    ...Object.fromEntries(NUMERIC_SETTINGS.map((n) => [n.key, settings[n.key] || 0])),
  };
}

export const getSystemSettings = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  res.json({ success: true, data: flagsPayload(settings), flags: FEATURE_FLAGS, numericSettings: NUMERIC_SETTINGS });
});

export const updateSystemSettings = asyncHandler(async (req, res) => {
  const validFlagKeys = new Set(FEATURE_FLAGS.map((f) => f.key));
  const validNumericKeys = new Set(NUMERIC_SETTINGS.map((n) => n.key));
  const patch = {};
  for (const [key, value] of Object.entries(req.body || {})) {
    if (validFlagKeys.has(key)) {
      if (typeof value !== 'boolean') throw new ApiError(400, `${key} must be a boolean`);
      patch[key] = value;
    } else if (validNumericKeys.has(key)) {
      const num = Number(value);
      if (!Number.isInteger(num) || num < 0) throw new ApiError(400, `${key} must be a non-negative integer`);
      patch[key] = num;
    }
    // unknown keys are silently ignored rather than erroring — forward-compatible
  }
  if (!Object.keys(patch).length) throw new ApiError(400, 'No valid settings provided');

  const settings = await updateSettings(patch);
  res.json({ success: true, data: flagsPayload(settings) });
});

const POPULATE = [
  { path: 'department', select: 'name code' },
  { path: 'batch', select: 'name code' },
  { path: 'semester', select: 'name code' },
];

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ----- Users -----

// Shared by listUsers and exportUsers so the two never drift apart — the
// exported CSV must reflect exactly the same filtered set a Super Admin
// sees on screen, minus pagination.
function buildUserFilter(req) {
  const { q, name, email, rollNo, department, batch, semester, role, status } = req.query;

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

  // administrator cannot see super_admin accounts at all — force-exclude
  // them, or flag "no rows at all" if super_admin was explicitly requested
  // via the role filter.
  if (!isRealSuperAdmin(req.user)) {
    if (role === 'super_admin') return null;
    filter.role = filter.role || { $ne: 'super_admin' };
  }

  return filter;
}

export const listUsers = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = buildUserFilter(req);

  if (!filter) {
    return res.json({ success: true, data: [], pagination: { page, limit, total: 0, pages: 0 } });
  }

  const [users, total] = await Promise.all([
    User.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: users.map((u) => u.toSafeObject()),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// GET /super-admin/users/export — CSV of every user matching the current
// filters (same filter-building as listUsers, no pagination) — reuses the
// exact same escape/response pattern as exportFeedback.js for consistency.
export const exportUsers = asyncHandler(async (req, res) => {
  const filter = buildUserFilter(req);
  const users = filter ? await User.find(filter).populate(POPULATE).sort({ createdAt: -1 }) : [];

  const escapeCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = [
    'Name',
    'Email',
    'Role',
    'Roll No',
    'Department',
    'Batch',
    'Semester',
    'Status',
    'Approval Status',
    'Last Login',
    'Last Login IP',
    'Created At',
  ];
  const rows = users.map((u) =>
    [
      u.name,
      u.email,
      u.role,
      u.rollNo || '',
      u.department?.code || u.department?.name || '',
      u.batch?.code || u.batch?.name || '',
      u.semester?.code || u.semester?.name || '',
      u.status,
      u.approvalStatus,
      u.lastLogin ? u.lastLogin.toISOString() : '',
      u.lastLoginIp || '',
      u.createdAt.toISOString(),
    ]
      .map(escapeCsv)
      .join(',')
  );
  const csv = [header.join(','), ...rows].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="users-export.csv"');
  res.send(csv);
});

export const getUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).populate(POPULATE);
  if (!user) throw new ApiError(404, 'User not found');
  // administrator cannot see a super_admin's record — reported as 404 so
  // its existence isn't confirmed either.
  if (user.role === 'super_admin' && !isRealSuperAdmin(req.user)) {
    throw new ApiError(404, 'User not found');
  }
  res.json({ success: true, data: user.toSafeObject() });
});

// Promotes a student to an admin-tier role (Admin, Administrator, or any
// role Super Admin has created — e.g. "CR"), or demotes one back to student.
// Deliberately cannot target or assign 'super_admin' or 'faculty' —
// super_admin is only ever set at the database level (seed script); faculty
// accounts go through their own dedicated creation flow (assignedDepartments
// /Courses setup). Granting/revoking 'administrator' — a super_admin-equivalent
// role — is further restricted to an actual super_admin actor, so an
// administrator can never mint another administrator or demote one.
export const updateUserRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (role !== 'student' && role !== 'administrator' && !(await roleExists(role))) {
    throw new ApiError(400, 'Role must be "student", "administrator", or an existing admin-tier role');
  }
  if (role === 'administrator' && !isRealSuperAdmin(req.user)) {
    throw new ApiError(403, 'Only Super Admin can grant the Administrator role', null, 'FORBIDDEN');
  }

  const target = await User.findById(req.params.id);
  if (!target) throw new ApiError(404, 'User not found');
  if (target.role === 'super_admin') {
    throw new ApiError(403, 'Super Admin role cannot be changed through the API', null, 'FORBIDDEN');
  }
  if (target.role === 'administrator' && !isRealSuperAdmin(req.user)) {
    throw new ApiError(403, "Only Super Admin can change an Administrator's role", null, 'FORBIDDEN');
  }
  if (target._id.equals(req.user._id)) {
    throw new ApiError(403, 'You cannot change your own role', null, 'FORBIDDEN');
  }

  target.role = role;
  target.tokenVersion += 1; // force re-login so the new role takes effect immediately
  await target.save();

  res.json({ success: true, message: `User role updated to ${role}`, data: target.toSafeObject() });
});

// Super Admin can directly edit a user's academic/profile fields — deliberately
// excludes password (must go through the change-password flow) and email/role
// (handled by their own dedicated, more carefully-gated endpoints).
export const updateUserProfile = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw new ApiError(404, 'User not found');
  if (target.role === 'super_admin' && !target._id.equals(req.user._id)) {
    throw new ApiError(403, "Another Super Admin's profile cannot be edited here", null, 'FORBIDDEN');
  }

  const allowed = ['name', 'rollNo', 'department', 'batch', 'semester'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) target[key] = req.body[key] || null;
  }
  // rollNo/name are plain strings, not refs — null would fail validation.
  if (req.body.name !== undefined) target.name = req.body.name;
  if (req.body.rollNo !== undefined) {
    const trimmedRollNo = String(req.body.rollNo || '').trim();
    // rollNo doubles as the institution's Student ID — globally unique
    // across every department/batch (see models/User.js's unique index).
    if (trimmedRollNo) {
      const duplicate = await User.findOne({ rollNo: trimmedRollNo, _id: { $ne: target._id } });
      if (duplicate) {
        throw new ApiError(409, 'This Roll No / Student ID is already registered to another account');
      }
    }
    target.rollNo = trimmedRollNo;
  }

  // assignedDepartments/assignedCourses scope Review/Approval access for any
  // admin-tier role other than the unrestricted 'admin' (e.g. "CR") — same
  // fields Faculty already uses, so a CR only reviews within their own
  // matching Department/Course.
  if (Array.isArray(req.body.assignedDepartments)) target.assignedDepartments = req.body.assignedDepartments;
  if (Array.isArray(req.body.assignedCourses)) target.assignedCourses = req.body.assignedCourses;

  await target.save();
  res.json({ success: true, message: 'Profile updated', data: target.toSafeObject() });
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

// ----- Faculty (Super Admin only — Faculty accounts are never provisioned
// through public registration or the role-promotion endpoint above) -----

const FACULTY_POPULATE = [
  { path: 'assignedDepartments', select: 'name code' },
  { path: 'assignedCourses', select: 'name courseId' },
];

export const listFaculty = asyncHandler(async (req, res) => {
  const faculty = await User.find({ role: 'faculty' }).populate(FACULTY_POPULATE).sort({ createdAt: -1 });
  res.json({ success: true, data: faculty.map((f) => f.toSafeObject()) });
});

export const createFaculty = asyncHandler(async (req, res) => {
  const { name, email, password, assignedDepartments, assignedCourses } = req.body;

  const existing = await User.findOne({ email: String(email).toLowerCase() });
  if (existing) throw new ApiError(409, 'An account with this email already exists');

  const faculty = await User.create({
    name,
    email,
    password,
    role: 'faculty',
    assignedDepartments: assignedDepartments || [],
    assignedCourses: assignedCourses || [],
  });

  res.status(201).json({ success: true, message: 'Faculty account created', data: faculty.toSafeObject() });
});

export const updateFaculty = asyncHandler(async (req, res) => {
  const faculty = await User.findOne({ _id: req.params.id, role: 'faculty' });
  if (!faculty) throw new ApiError(404, 'Faculty not found');

  const allowed = ['name', 'email', 'assignedDepartments', 'assignedCourses'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) faculty[key] = req.body[key];
  }
  await faculty.save();

  res.json({ success: true, message: 'Faculty updated', data: faculty.toSafeObject() });
});

// ----- Files (system-wide) -----

const FILE_LIST_FIELDS =
  'title originalName fileType mimeType fileSize fileUrl fileCount departmentCode courseName courseId batchCodes allBatches semester academicYear categoryName views downloads uploadedBy status createdAt';

// Typo-tolerant, same engine as GET /search (see fuzzyFileSearch.js) —
// short/absent `q` keeps the original fast DB-only path untouched.
export const listAllFiles = asyncHandler(async (req, res) => {
  const { q, department, course, uploadedBy } = req.query;
  const { page, limit, skip } = parsePagination(req.query);

  const filter = {};
  if (department) filter.department = department;
  if (course) filter.course = course;
  if (uploadedBy) filter.uploadedBy = uploadedBy;

  const cleanQuery = sanitizeQuery(q);
  if (q && cleanQuery.length >= 2) {
    const { ranked } = await rankFileCandidates(filter, q);
    const rankedTotal = ranked.length;

    const start = (page - 1) * limit;
    const pageIds = ranked.slice(start, start + limit).map((r) => r.file._id);
    const scoreById = new Map(ranked.map((r) => [String(r.file._id), { score: r.score, matchType: r.matchType }]));

    // Re-fetch just this page's ids with the real projection/populate — the
    // ranking pass itself works off full unprojected documents.
    const files = await File.find({ _id: { $in: pageIds } }).select(FILE_LIST_FIELDS).populate('uploadedBy', 'name email role');
    const byId = new Map(files.map((f) => [String(f._id), f]));
    const data = pageIds
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((f) => ({ ...f.toObject(), ...scoreById.get(String(f._id)) }));

    return res.json({
      success: true,
      data,
      pagination: { page, limit, total: rankedTotal, pages: Math.ceil(rankedTotal / limit) },
    });
  }

  const [files, total] = await Promise.all([
    File.find(filter)
      .select(FILE_LIST_FIELDS)
      .populate('uploadedBy', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    File.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: files,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
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
