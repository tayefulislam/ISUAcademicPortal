import { getSettings } from '../models/Settings.js';
import { getEffectiveCourseIds } from './courseAccessService.js';

/**
 * Builds a MongoDB filter for the File collection from search/list query
 * params PLUS the access-control clause (visibility + restrictions) for the
 * given viewer. Shared by GET /api/files and GET /api/search so both honor
 * identical filters and identical access rules — this is the single
 * enforcement point; nothing bypasses it except super_admin and a file's
 * own uploader (checked separately, see fileMatchesAccess below).
 */
export async function buildFileQuery(query, user) {
  const {
    q,
    department,
    course,
    courseId,
    batch,
    semester,
    academicYear,
    fileType,
    category,
    materialType, // UI alias for `category` ("Material Type")
    chapter,
    topic,
    dateFrom,
    dateTo,
  } = query;

  // Student submissions are 'pending' until reviewed — never visible through
  // any listing/search/browse path, regardless of visibility/restrictions.
  // The uploader tracks their own submission via GET /files/mine instead,
  // and reviewers via the dedicated /reviews queue — both bypass this filter.
  const filter = { status: 'active', approvalStatus: 'approved' };

  if (q) filter.$text = { $search: String(q) };
  if (department) filter.department = department;
  if (course) filter.course = course;
  if (courseId) filter.courseId = new RegExp(`^${escapeRegex(courseId)}$`, 'i');
  if (batch) filter.$or = [{ batches: batch }, { batchCodes: new RegExp(`^${escapeRegex(batch)}$`, 'i') }, { allBatches: true }];
  if (semester) filter.semester = semester;
  if (academicYear) filter.academicYear = academicYear;
  if (fileType) filter.fileType = fileType;
  if (category || materialType) filter.category = category || materialType;
  if (chapter) filter.chapter = chapter;
  if (topic) filter.topic = topic;

  if (dateFrom || dateTo) {
    filter.createdAt = {};
    if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
    if (dateTo) filter.createdAt.$lte = new Date(dateTo);
  }

  const accessCtx = await buildAccessContext(user);
  const accessFilter = accessMongoFilter(accessCtx);
  if (accessFilter) filter.$and = (filter.$and || []).concat([accessFilter]);

  return filter;
}

export function buildSortOption(sort, hasTextSearch) {
  if (hasTextSearch && !sort) return { score: { $meta: 'textScore' }, createdAt: -1 };

  switch (sort) {
    case 'oldest':
      return { createdAt: 1 };
    case 'popular':
      return { views: -1, downloads: -1 };
    case 'downloads':
      return { downloads: -1 };
    case 'name':
      return { title: 1 };
    case 'newest':
    default:
      return { createdAt: -1 };
  }
}

// ----- Access control (visibility + restrictions) -----
//
// A file is visible to a viewer if:
//   - visibility === 'public', OR
//   - visibility === 'login_required' AND the viewer is signed in AND
//     (the file has no restrictions on any axis, OR every non-empty
//     restriction axis matches the viewer's own department/batch/semester,
//     with the `course` axis matched via getEffectiveCourseIds — the
//     department's own course list PLUS any course the viewer has an
//     active/approved CourseEnrollment for, e.g. a retake outside their own
//     department/semester) AND, only when the global student-approval
//     system is ON, the viewer's approvalStatus is 'approved' (a
//     pending/rejected student can still see unrestricted login_required
//     files, just not restricted ones).
// super_admin bypasses all of this (handled by the caller returning `bypass`).

/**
 * @returns {Promise<{bypass:boolean, user, blockedFromRestricted:boolean, deptCourseIds: string[]}>}
 */
export async function buildAccessContext(user) {
  if (!user) return { bypass: false, user: null, blockedFromRestricted: true, deptCourseIds: [] };
  if (user.role === 'super_admin' || user.role === 'administrator') return { bypass: true, user, blockedFromRestricted: false, deptCourseIds: [] };

  const settings = await getSettings();
  const blockedFromRestricted =
    settings.studentApprovalEnabled && user.role === 'student' && user.approvalStatus !== 'approved';

  const deptCourseIds = await getEffectiveCourseIds(user);

  return { bypass: false, user, blockedFromRestricted, deptCourseIds };
}

function accessMongoFilter(ctx) {
  if (ctx.bypass) return null;

  if (!ctx.user) return { visibility: 'public' };

  const noRestriction = {
    $and: [
      { 'restrictions.departments.0': { $exists: false } },
      { 'restrictions.batches.0': { $exists: false } },
      { 'restrictions.semesters.0': { $exists: false } },
      { 'restrictions.courses.0': { $exists: false } },
    ],
  };

  if (ctx.blockedFromRestricted) {
    return { $or: [{ visibility: 'public' }, { $and: [{ visibility: 'login_required' }, noRestriction] }] };
  }

  const matches = {
    $and: [
      { $or: [{ 'restrictions.departments.0': { $exists: false } }, { 'restrictions.departments': ctx.user.department }] },
      { $or: [{ 'restrictions.batches.0': { $exists: false } }, { 'restrictions.batches': ctx.user.batch }] },
      { $or: [{ 'restrictions.semesters.0': { $exists: false } }, { 'restrictions.semesters': ctx.user.semester }] },
      { $or: [{ 'restrictions.courses.0': { $exists: false } }, { 'restrictions.courses': { $in: ctx.deptCourseIds } }] },
    ],
  };

  return { $or: [{ visibility: 'public' }, { $and: [{ visibility: 'login_required' }, matches] }] };
}

/**
 * Same rule set as accessMongoFilter, evaluated against one already-fetched
 * File document — used by getFile/recordDownload so a direct link can't
 * bypass the list-level filtering. `owner` bypass covers the uploading
 * admin viewing/downloading their own file regardless of restrictions.
 */
export async function userCanAccessFile(file, user) {
  if (user && (user.role === 'super_admin' || user.role === 'administrator')) return true;
  if (user && file.uploadedBy && String(file.uploadedBy) === String(user._id)) return true;

  // Pending submissions are invisible to everyone except the uploader
  // (checked above), super_admin, admin, administrator, or an in-scope
  // faculty reviewer — regardless of visibility/restrictions, which only
  // apply once approved.
  if (file.approvalStatus === 'pending') {
    if (!user) return false;
    if (user.role === 'admin') return true;
    if (user.role === 'faculty') return isFacultyScopedToFile(user, file);
    return false;
  }

  if (file.visibility === 'public') return true;
  if (!user) return false;

  const settings = await getSettings();
  const blockedFromRestricted =
    settings.studentApprovalEnabled && user.role === 'student' && user.approvalStatus !== 'approved';

  const r = file.restrictions || {};
  const hasAnyRestriction =
    (r.departments && r.departments.length) ||
    (r.batches && r.batches.length) ||
    (r.semesters && r.semesters.length) ||
    (r.courses && r.courses.length);

  if (!hasAnyRestriction) return !blockedFromRestricted;
  if (blockedFromRestricted) return false;

  const deptOk = !r.departments?.length || r.departments.some((d) => String(d) === String(user.department));
  const batchOk = !r.batches?.length || r.batches.some((b) => String(b) === String(user.batch));
  const semOk = !r.semesters?.length || r.semesters.some((s) => String(s) === String(user.semester));

  let courseOk = true;
  if (r.courses?.length) {
    const effectiveCourseIds = await getEffectiveCourseIds(user);
    const effectiveCourseIdSet = new Set(effectiveCourseIds);
    courseOk = r.courses.some((c) => effectiveCourseIdSet.has(String(c)));
  }

  return deptOk && batchOk && semOk && courseOk;
}

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True if `user` (a faculty member) is assigned to `file`'s department or
 * course — scopes their review/management powers. Not meaningful for other
 * roles (callers only invoke this for user.role === 'faculty').
 */
export function isFacultyScopedToFile(user, file) {
  const depts = (user.assignedDepartments || []).map(String);
  const courses = (user.assignedCourses || []).map(String);
  return depts.includes(String(file.department)) || courses.includes(String(file.course));
}
