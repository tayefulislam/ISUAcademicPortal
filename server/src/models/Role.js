import mongoose from 'mongoose';

// PERMISSION_MODULES is the single source of truth for which admin-tier menu
// items/actions exist — the Permissions page (Super Admin) reads this list
// rather than hardcoding each one, so adding a new gated module later is
// just: add an entry here + wrap its routes in requirePermission(key).
//
// This only covers the "admin-tier" modules — Student/Faculty/Super Admin
// keep their existing hardcoded access model untouched; this system is for
// Admin plus any further roles (e.g. "CR") Super Admin creates to sit at
// that same tier with a configurable subset of its capabilities.
export const PERMISSION_MODULES = [
  { key: 'files', label: 'File Management', description: 'Upload, edit, delete files and manage file versions.' },
  { key: 'approvals', label: 'Student Approvals', description: 'Review and approve/reject pending student ID photos.' },
  { key: 'reviews', label: 'Material Review', description: 'Review student-submitted materials before publishing.' },
  { key: 'notices', label: 'Notices & Announcements', description: 'Create and manage notices.' },
  { key: 'assignments', label: 'Assignments', description: 'Create, grade, and manage assignments.' },
  { key: 'question_bank', label: 'Question Bank', description: 'Manage the shared question bank.' },
  { key: 'quizzes', label: 'Quizzes', description: 'Create and manage quizzes.' },
  { key: 'messages', label: 'Messages', description: 'Access Faculty-Student messaging as an admin-tier user.' },
  { key: 'emails', label: 'Email Center', description: 'Send broadcast emails.' },
  { key: 'enrollments', label: 'Course Enrollment Management', description: 'Review/approve/reject additional-course enrollment requests and manage enrollments.' },
  { key: 'notifications', label: 'Notification Management', description: 'Send notifications to users/courses/departments and view delivery stats.' },
  { key: 'documents', label: 'Document Generator', description: 'Manage cover-page/document templates — create, upload a design, map fields, version and publish them.' },
  // Class routine & academic calendar. Split per action rather than one
  // "routine" key so a CR can be given "add exams" without also being able to
  // rewrite the official timetable. Student/Faculty/CR reach these routes
  // through requirePermission's allowRoles escape hatch (they hold no Role
  // document), so granting an admin-tier role here is additive.
  { key: 'routine_view', label: 'Routine — View', description: 'See the class routine and academic calendar for a wider scope than their own.' },
  { key: 'routine_create', label: 'Routine — Create', description: 'Create class routine entries and recurring schedules.' },
  { key: 'routine_update', label: 'Routine — Update', description: 'Edit, cancel or reschedule class routine entries.' },
  { key: 'routine_delete', label: 'Routine — Delete', description: 'Delete class routine entries and templates.' },
  { key: 'exam_view', label: 'Exams — View', description: 'See exam/CT/final entries for a wider scope than their own.' },
  { key: 'exam_create', label: 'Exams — Create', description: 'Schedule CT / Mid Term / Final / Quiz and other academic events.' },
  { key: 'exam_update', label: 'Exams — Update', description: 'Edit scheduled exams and academic events.' },
  { key: 'exam_delete', label: 'Exams — Delete', description: 'Delete scheduled exams and academic events.' },
  { key: 'calendar_manage', label: 'Calendar — Manage', description: 'Override schedule conflicts and manage calendar-wide actions.' },
];

const roleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    // The seeded 'admin' role — cannot be deleted/renamed (its permissions
    // can still be edited), so there's always at least one usable admin-tier
    // role even if Super Admin experiments with custom ones.
    isProtected: { type: Boolean, default: false },
    permissions: [{ type: String, enum: PERMISSION_MODULES.map((m) => m.key) }],
  },
  { timestamps: true }
);

const Role = mongoose.model('Role', roleSchema);

const ALL_PERMISSION_KEYS = PERMISSION_MODULES.map((m) => m.key);

// Lazily seeds the 'admin' role (all permissions) the first time anything
// touches the Role collection — mirrors Settings.getSettings()'s singleton
// pattern so there's no separate migration step to remember to run.
async function ensureAdminRoleSeeded() {
  await Role.findOneAndUpdate(
    { key: 'admin' },
    { $setOnInsert: { key: 'admin', name: 'Admin', isProtected: true, permissions: ALL_PERMISSION_KEYS } },
    { upsert: true }
  );
}

export async function listRoles() {
  await ensureAdminRoleSeeded();
  return Role.find().sort({ createdAt: 1 });
}

export async function getRole(key) {
  if (key === 'admin') await ensureAdminRoleSeeded();
  return Role.findOne({ key });
}

export async function roleExists(key) {
  if (key === 'admin') await ensureAdminRoleSeeded();
  return Role.exists({ key });
}

// True for any admin-tier role (super_admin is handled separately by
// callers — it always bypasses permission checks entirely and is never
// stored here). Used by controllers that currently special-case
// `role === 'admin'` for oversight bypasses, so a role like "CR" — created
// with the same permissions as Admin — gets the same bypasses.
// 'administrator' is excluded too — it's not a Role-collection entry, it's a
// fixed super_admin-equivalent role (see isSuperAdminTier).
export async function isAdminTierRole(roleKey) {
  if (!roleKey || roleKey === 'student' || roleKey === 'faculty' || roleKey === 'super_admin' || roleKey === 'administrator') return false;
  return Boolean(await roleExists(roleKey));
}

// True for super_admin and administrator — administrator has every
// super_admin capability except visibility/control over super_admin
// accounts themselves (enforced in superAdminController.js).
export function isSuperAdminTier(roleKey) {
  return roleKey === 'super_admin' || roleKey === 'administrator';
}

export default Role;
