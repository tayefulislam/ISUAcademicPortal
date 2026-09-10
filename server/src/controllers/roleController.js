import Role, { PERMISSION_MODULES, listRoles as listRolesData } from '../models/Role.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

function slugify(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// GET /roles — every admin-tier role plus how many users currently hold it
// (so the Permissions page can warn before deleting an in-use role).
export const listRoles = asyncHandler(async (req, res) => {
  const roles = await listRolesData();
  const counts = await User.aggregate([
    { $match: { role: { $in: roles.map((r) => r.key) } } },
    { $group: { _id: '$role', count: { $sum: 1 } } },
  ]);
  const countByKey = new Map(counts.map((c) => [c._id, c.count]));

  res.json({
    success: true,
    data: roles.map((r) => ({ ...r.toObject(), userCount: countByKey.get(r.key) || 0 })),
    modules: PERMISSION_MODULES,
  });
});

// POST /roles { name, permissions?, copyFrom? } — Super Admin creates a new
// admin-tier role. `copyFrom` (an existing role key) seeds its permission
// set — e.g. creating "CR" as a copy of "admin" gives it the exact same
// access as Admin has right now, without hand-picking every module.
export const createRole = asyncHandler(async (req, res) => {
  const { name, permissions, copyFrom } = req.body;
  if (!name || !name.trim()) throw new ApiError(400, 'A role name is required');

  const key = slugify(name);
  if (!key) throw new ApiError(400, 'That name could not be turned into a valid role key');
  if (['student', 'faculty', 'admin', 'administrator', 'super_admin'].includes(key)) {
    throw new ApiError(409, `"${key}" is a reserved role and cannot be recreated here`);
  }
  if (await Role.findOne({ key })) {
    throw new ApiError(409, 'A role with this name already exists');
  }

  let resolvedPermissions = Array.isArray(permissions) ? permissions : [];
  if (copyFrom) {
    const source = await Role.findOne({ key: copyFrom });
    if (!source) throw new ApiError(404, 'The role to copy permissions from was not found');
    resolvedPermissions = source.permissions;
  }
  const validKeys = new Set(PERMISSION_MODULES.map((m) => m.key));
  resolvedPermissions = resolvedPermissions.filter((p) => validKeys.has(p));

  const role = await Role.create({ key, name: name.trim(), permissions: resolvedPermissions });
  res.status(201).json({ success: true, message: `Role "${role.name}" created`, data: role });
});

// PATCH /roles/:key { permissions } — full replace, toggled from the
// Permissions page's checkbox grid.
export const updateRolePermissions = asyncHandler(async (req, res) => {
  const role = await Role.findOne({ key: req.params.key });
  if (!role) throw new ApiError(404, 'Role not found');

  const validKeys = new Set(PERMISSION_MODULES.map((m) => m.key));
  const permissions = [].concat(req.body.permissions || []).filter((p) => validKeys.has(p));
  role.permissions = permissions;
  await role.save();

  res.json({ success: true, message: `${role.name} permissions updated`, data: role });
});

// DELETE /roles/:key — refuses to delete the protected 'admin' role or a
// role currently assigned to at least one user (they'd be left with an
// unresolvable role string otherwise — must be reassigned first).
export const deleteRole = asyncHandler(async (req, res) => {
  const role = await Role.findOne({ key: req.params.key });
  if (!role) throw new ApiError(404, 'Role not found');
  if (role.isProtected) throw new ApiError(403, 'The Admin role cannot be deleted', null, 'FORBIDDEN');

  const inUse = await User.exists({ role: role.key });
  if (inUse) throw new ApiError(409, 'Reassign every user with this role before deleting it');

  await role.deleteOne();
  res.json({ success: true, message: `Role "${role.name}" deleted` });
});
