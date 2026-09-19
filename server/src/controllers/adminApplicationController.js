import ApplicationType from '../models/ApplicationType.js';
import ApplicationRecipient from '../models/ApplicationRecipient.js';
import UserCredit from '../models/UserCredit.js';
import Department from '../models/Department.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { parsePagination } from '../utils/pagination.js';
import * as credits from '../services/applications/creditService.js';

// Admin management for Write Application: the types, the official recipients,
// the department heads they resolve against, and the credit ledger. Guarded by
// requirePermission('applications') at the router (super-admin tier bypasses).

function cleanFields(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((field) => field && field.key && field.label)
    .map((field) => ({
      key: String(field.key).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60),
      label: String(field.label).trim().slice(0, 120),
      type: ['TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN'].includes(field.type) ? field.type : 'TEXT',
      required: Boolean(field.required),
      placeholder: String(field.placeholder || '').slice(0, 160),
      options: Array.isArray(field.options) ? field.options.map((o) => String(o).slice(0, 80)).slice(0, 30) : [],
    }));
}

// ----- Application types -----

export const listTypes = asyncHandler(async (req, res) => {
  const types = await ApplicationType.find({}).sort({ order: 1, name: 1 });
  res.json({ success: true, data: types });
});

export const createType = asyncHandler(async (req, res) => {
  const { key, name, description, order, defaultInstructions, active, template } = req.body || {};
  if (!key || !name) throw new ApiError(422, 'A key and a name are required');
  const exists = await ApplicationType.findOne({ key: String(key).toLowerCase() });
  if (exists) throw new ApiError(409, 'That application type already exists');
  const type = await ApplicationType.create({
    key: String(key).toLowerCase().trim(),
    name,
    description: description || '',
    order: Number(order) || 0,
    active: active !== false,
    defaultInstructions: defaultInstructions || '',
    fields: cleanFields(req.body?.fields),
    template: template || {},
  });
  res.status(201).json({ success: true, data: type });
});

export const updateType = asyncHandler(async (req, res) => {
  const type = await ApplicationType.findById(req.params.id);
  if (!type) throw new ApiError(404, 'Application type not found');
  const { name, description, order, defaultInstructions, active, template, key } = req.body || {};
  if (key && key !== type.key) {
    const clash = await ApplicationType.findOne({ key: String(key).toLowerCase(), _id: { $ne: type._id } });
    if (clash) throw new ApiError(409, 'Another type already uses that key');
    type.key = String(key).toLowerCase().trim();
  }
  if (name !== undefined) type.name = name;
  if (description !== undefined) type.description = description;
  if (order !== undefined) type.order = Number(order) || 0;
  if (defaultInstructions !== undefined) type.defaultInstructions = defaultInstructions;
  if (active !== undefined) type.active = Boolean(active);
  if (template !== undefined) type.template = { ...type.template.toObject(), ...template };
  if (req.body?.fields !== undefined) type.fields = cleanFields(req.body.fields);
  await type.save();
  res.json({ success: true, data: type });
});

export const deleteType = asyncHandler(async (req, res) => {
  const type = await ApplicationType.findByIdAndDelete(req.params.id);
  if (!type) throw new ApiError(404, 'Application type not found');
  res.json({ success: true, message: 'Application type deleted' });
});

// ----- Recipients -----

export const listRecipients = asyncHandler(async (req, res) => {
  const recipients = await ApplicationRecipient.find({})
    .populate('department', 'name code')
    .sort({ order: 1, name: 1 });
  res.json({ success: true, data: recipients });
});

export const createRecipient = asyncHandler(async (req, res) => {
  const { name, designation, office, address, type, department, active, order } = req.body || {};
  if (!name) throw new ApiError(422, 'A recipient name is required');
  const recipient = await ApplicationRecipient.create({
    name,
    designation: designation || '',
    office: office || '',
    address: address || '',
    type: type || 'OTHER',
    department: department || null,
    active: active !== false,
    order: Number(order) || 0,
  });
  res.status(201).json({ success: true, data: recipient });
});

export const updateRecipient = asyncHandler(async (req, res) => {
  const recipient = await ApplicationRecipient.findById(req.params.id);
  if (!recipient) throw new ApiError(404, 'Recipient not found');
  for (const key of ['name', 'designation', 'office', 'address', 'type']) {
    if (req.body?.[key] !== undefined) recipient[key] = req.body[key];
  }
  if (req.body?.department !== undefined) recipient.department = req.body.department || null;
  if (req.body?.active !== undefined) recipient.active = Boolean(req.body.active);
  if (req.body?.order !== undefined) recipient.order = Number(req.body.order) || 0;
  if (req.body?.letterhead !== undefined) {
    recipient.letterhead = { ...recipient.letterhead.toObject(), ...req.body.letterhead };
  }
  await recipient.save();
  res.json({ success: true, data: recipient });
});

export const deleteRecipient = asyncHandler(async (req, res) => {
  const recipient = await ApplicationRecipient.findByIdAndDelete(req.params.id);
  if (!recipient) throw new ApiError(404, 'Recipient not found');
  res.json({ success: true, message: 'Recipient deleted' });
});

/** The official head of a department — how "Head of Department" is resolved. */
export const setDepartmentHead = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department) throw new ApiError(404, 'Department not found');
  const headId = req.body?.head || null;
  if (headId) {
    const user = await User.findById(headId).select('name role');
    if (!user) throw new ApiError(422, 'That user does not exist');
  }
  department.head = headId;
  await department.save();
  res.json({ success: true, data: { _id: String(department._id), head: headId ? String(headId) : null } });
});

export const listDepartments = asyncHandler(async (req, res) => {
  const departments = await Department.find({})
    .populate('head', 'name designation')
    .select('name code head')
    .sort({ name: 1 });
  res.json({ success: true, data: departments });
});

// ----- Credits -----

export const listCredits = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {};
  if (req.query.search) {
    const safe = String(req.query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const users = await User.find({
      $or: [{ name: { $regex: safe, $options: 'i' } }, { email: { $regex: safe, $options: 'i' } }],
    }).select('_id').lean();
    filter.user = { $in: users.map((u) => u._id) };
  }
  const [rows, total] = await Promise.all([
    UserCredit.find(filter)
      .populate('user', 'name email role rollNo')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit),
    UserCredit.countDocuments(filter),
  ]);
  res.json({
    success: true,
    data: rows.map((row) => ({
      userId: String(row.user?._id || row.user),
      name: row.user?.name || '',
      email: row.user?.email || '',
      role: row.user?.role || '',
      monthlyAllocation: row.monthlyAllocation,
      balance: row.balance,
      usedThisPeriod: row.usedThisPeriod,
      lastRechargeAt: row.lastRechargeAt,
      nextRechargeAt: row.nextRechargeAt,
      status: row.status,
    })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const adjustCredits = asyncHandler(async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isInteger(amount) || amount === 0) {
    throw new ApiError(422, 'A non-zero whole-number adjustment is required');
  }
  const target = await User.findById(req.params.userId).select('name');
  if (!target) throw new ApiError(404, 'User not found');
  const summary = await credits.adjust(req.user._id, target._id, amount, req.body?.description);
  res.json({ success: true, data: summary });
});

export const userCreditHistory = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await credits.getHistory(req.params.userId, req.query.limit) });
});
