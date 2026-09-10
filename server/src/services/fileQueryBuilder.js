import { getEffectiveCourseIds, isBlockedByApproval } from './courseAccessService.js';

/**
 * Builds a MongoDB filter for the File collection from search/list query
 * params PLUS the access-control clause (visibility + restrictions) for the
 * given viewer. Shared by GET /api/files and GET /api/search so both honor
 * identical filters and identical access rules — this is the single
 * enforcement point; nothing bypasses it except super_admin and a file's
 * own uploader (checked separately, see fileMatchesAccess below).
 */
export async function buildFileQuery(query, user, opts = {}) {
  const { includeLocked = false, accessCtx } = opts;
  const {
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

  // Free-text `q` matching is handled separately by fuzzyFileSearch.js
  // (typo-tolerant scoring), not by MongoDB's plain $text index — this
  // filter only ever expresses the exact/structured axes.
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

  // `includeLocked` is used by the public browsing surfaces (GET /files,
  // /search, /files/recent, /files/popular, /files/dashboard,
  // /files/:id/related) — instead of excluding restricted files a viewer
  // can't open, the listing includes them (title/metadata visible to
  // everyone) and the caller attaches a `locked` flag per item via
  // attachFileLocks() below, so the UI can show "Login Required" in place of
  // View/Download rather than hiding the file's existence entirely.
  const ctx = accessCtx || (await buildAccessContext(user));
  if (!includeLocked) {
    const accessFilter = accessMongoFilter(ctx);
    if (accessFilter) filter.$and = (filter.$and || []).concat([accessFilter]);
  }

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
//   - visibility === 'login_required' AND the viewer is signed in AND NOT
//     blocked-by-approval (see isBlockedByApproval — a pending/rejected
//     student, only while the global approval system is ON, cannot see ANY
//     login-required content, restricted or not — approval is an all-or-
//     nothing gate on login-required content, same as it is for Assignment
//     submission/Quiz attempts/Messaging) AND (the file has no restrictions
//     on any axis, OR every non-empty restriction axis matches the viewer's
//     own department/batch/semester, with the `course` axis matched via
//     getEffectiveCourseIds — the department's own course list PLUS any
//     course the viewer has an active/approved CourseEnrollment for, e.g. a
//     retake outside their own department/semester).
// super_admin bypasses all of this (handled by the caller returning `bypass`).

/**
 * @returns {Promise<{bypass:boolean, user, blockedFromRestricted:boolean, deptCourseIds: string[]}>}
 */
export async function buildAccessContext(user) {
  if (!user) return { bypass: false, user: null, blockedFromRestricted: true, deptCourseIds: [] };
  if (user.role === 'super_admin' || user.role === 'administrator') return { bypass: true, user, blockedFromRestricted: false, deptCourseIds: [] };

  const blockedFromRestricted = await isBlockedByApproval(user);
  const deptCourseIds = await getEffectiveCourseIds(user);

  return { bypass: false, user, blockedFromRestricted, deptCourseIds };
}

function accessMongoFilter(ctx) {
  if (ctx.bypass) return null;

  if (!ctx.user) return { visibility: 'public' };

  // A pending/rejected student (blockedFromRestricted) can only see fully
  // public content — no login-required file at all, restricted or not —
  // until an Admin approves them.
  if (ctx.blockedFromRestricted) {
    return { visibility: 'public' };
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
 * Sync mirror of accessMongoFilter's rules, evaluated per-document (no extra
 * DB calls — `ctx` already carries everything needed) — used by the public
 * listing surfaces to mark a file `locked` instead of excluding it. A file's
 * own uploader/admin bypass is handled by `ctx.bypass`; ownership isn't
 * checked here since these listing paths never include pending/other users'
 * unlisted content in the first place.
 */
export function computeFileLocked(file, ctx) {
  if (ctx.bypass) return false;
  if (file.visibility === 'public') return false;
  if (!ctx.user) return true;
  // A pending/rejected student can't see ANY login-required content until
  // approved — restricted or not (see buildAccessContext's comment).
  if (ctx.blockedFromRestricted) return true;

  const r = file.restrictions || {};
  const hasAnyRestriction = !!(r.departments?.length || r.batches?.length || r.semesters?.length || r.courses?.length);
  if (!hasAnyRestriction) return false;

  const deptOk = !r.departments?.length || r.departments.some((d) => String(d) === String(ctx.user.department));
  const batchOk = !r.batches?.length || r.batches.some((b) => String(b) === String(ctx.user.batch));
  const semOk = !r.semesters?.length || r.semesters.some((s) => String(s) === String(ctx.user.semester));
  const courseOk = !r.courses?.length || r.courses.some((c) => ctx.deptCourseIds.includes(String(c)));

  return !(deptOk && batchOk && semOk && courseOk);
}

/** Maps a list of File docs/plain objects to plain objects with a `locked`
 * flag attached and the underlying `restrictions`/`visibility` fields
 * stripped (the flag is all a viewer who can't access the file should see). */
export function attachFileLocks(files, ctx) {
  return files.map((f) => {
    const obj = typeof f.toObject === 'function' ? f.toObject() : { ...f };
    obj.locked = computeFileLocked(obj, ctx);
    delete obj.restrictions;
    delete obj.visibility;
    return obj;
  });
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

  // A pending/rejected student can't see ANY login-required content until
  // approved — restricted or not (see buildAccessContext's comment).
  if (await isBlockedByApproval(user)) return false;

  const r = file.restrictions || {};
  const hasAnyRestriction =
    (r.departments && r.departments.length) ||
    (r.batches && r.batches.length) ||
    (r.semesters && r.semesters.length) ||
    (r.courses && r.courses.length);

  if (!hasAnyRestriction) return true;

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
