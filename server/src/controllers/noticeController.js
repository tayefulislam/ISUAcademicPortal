import fs from 'node:fs/promises';
import Notice from '../models/Notice.js';
import { isAdminTierRole } from '../models/Role.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { storeUploadedFileFromPath, deleteStoredFile } from '../services/storage/storageService.js';
import { recordDomainOptimization } from '../services/uploads/metadata/recordBridge.js';
import { getEffectiveCourseIds } from '../services/courseAccessService.js';
import { emit } from '../services/notifications/notificationService.js';
import { resolveNoticeRecipients } from '../services/notifications/recipientResolver.js';

function notifyNotice(notice, actor, type) {
  resolveNoticeRecipients(notice.targeting)
    .then((recipients) =>
      emit({
        type,
        actorId: actor._id,
        entityType: 'NOTICE',
        entityId: notice._id,
        vars: { title: notice.title, noticeId: notice._id },
        recipients,
      })
    )
    .catch((err) => console.error('[notify] notice', err));
}

const POPULATE = [
  { path: 'targeting.departments', select: 'name code' },
  { path: 'targeting.courses', select: 'name courseId' },
  { path: 'targeting.batches', select: 'name code' },
  { path: 'targeting.semesters', select: 'name code' },
  { path: 'createdBy', select: 'name role' },
];

function parseTargeting(body) {
  const everyone = body.everyone === 'true' || body.everyone === true;
  return {
    everyone,
    departments: everyone ? [] : [].concat(body.departments || []).filter(Boolean),
    courses: everyone ? [] : [].concat(body.courses || []).filter(Boolean),
    batches: everyone ? [] : [].concat(body.batches || []).filter(Boolean),
    semesters: everyone ? [] : [].concat(body.semesters || []).filter(Boolean),
  };
}

// Faculty may only target their own assigned Department(s)/Course(s) — never
// "everyone", and never a department/course outside their assignment.
function assertFacultyTargetingScope(targeting, user) {
  if (targeting.everyone) throw new ApiError(403, 'Faculty cannot target "Everyone" — pick your assigned department/course', null, 'FORBIDDEN');
  const deptIds = new Set((user.assignedDepartments || []).map(String));
  const courseIds = new Set((user.assignedCourses || []).map(String));
  const badDept = targeting.departments.find((d) => !deptIds.has(String(d)));
  const badCourse = targeting.courses.find((c) => !courseIds.has(String(c)));
  if (badDept || badCourse) {
    throw new ApiError(403, 'You can only target your own assigned Department(s)/Course(s)', null, 'FORBIDDEN');
  }
  if (!targeting.departments.length && !targeting.courses.length && !targeting.batches.length && !targeting.semesters.length) {
    throw new ApiError(400, 'Select at least one department, course, batch, or semester to target');
  }
}

function assertManageAccess(notice, user) {
  if (user.role === 'super_admin' || user.role === 'administrator') return;
  if (!notice.createdBy.equals(user._id)) {
    throw new ApiError(403, 'You can only manage notices you created', null, 'FORBIDDEN');
  }
}

export const createNotice = asyncHandler(async (req, res) => {
  const { title, description, type, priority, publishDate, expiryDate } = req.body;
  const targeting = parseTargeting(req.body);

  if (req.user.role === 'faculty') assertFacultyTargetingScope(targeting, req.user);

  let attachment = { attachmentUrl: '', attachmentName: '', storageProvider: '', storageRef: '' };
  let stored = null;
  if (req.file) {
    stored = await storeStoredAttachment(req);
    attachment = {
      attachmentUrl: stored.fileUrl,
      attachmentName: req.file.originalname,
      storageProvider: stored.storageProvider,
      storageRef: stored.storageRef,
    };
  }

  const notice = await Notice.create({
    title,
    description,
    type,
    priority,
    publishDate: publishDate || undefined,
    expiryDate: expiryDate || null,
    targeting,
    ...attachment,
    createdBy: req.user._id,
  });

  if (stored) await queueAttachmentOptimization(notice, stored, req);

  if (notice.status === 'published') notifyNotice(notice, req.user, 'NOTICE_CREATED');
  res.status(201).json({ success: true, data: notice });
});

/**
 * Stores a spooled notice attachment without buffering it in the heap, and
 * reclaims the spool copy immediately.
 */
async function storeStoredAttachment(req) {
  const stored = await storeUploadedFileFromPath(req.file.path, req.file.originalname, req.file.mimetype, {
    purpose: 'notice',
    ownerId: String(req.user._id),
    size: req.file.size,
  });
  await fs.rm(req.file.path, { force: true }).catch(() => null);
  return stored;
}

/** Records the notice's attachment with the pipeline so it is optimized async. */
async function queueAttachmentOptimization(notice, stored, req) {
  await recordDomainOptimization({
    ownerId: req.user._id,
    kind: 'notice',
    recordId: notice._id,
    purpose: 'notice',
    items: [
      {
        field: 'attachment',
        storageProvider: stored.storageProvider,
        storageRef: stored.storageRef,
        mimeType: req.file.mimetype,
        originalName: req.file.originalname,
        fileSize: stored.size || req.file.size,
      },
    ],
  }).catch(() => null);
}

export const updateNotice = asyncHandler(async (req, res) => {
  const notice = await Notice.findById(req.params.id);
  if (!notice) throw new ApiError(404, 'Notice not found');
  assertManageAccess(notice, req.user);
  const wasPublished = notice.status === 'published';

  const allowed = ['title', 'description', 'type', 'priority', 'publishDate', 'expiryDate', 'status'];
  for (const key of allowed) {
    if (req.body[key] !== undefined) notice[key] = req.body[key] || (key === 'expiryDate' ? null : notice[key]);
  }

  if (req.body.everyone !== undefined || req.body.departments || req.body.courses || req.body.batches || req.body.semesters) {
    const targeting = parseTargeting(req.body);
    if (req.user.role === 'faculty') assertFacultyTargetingScope(targeting, req.user);
    notice.targeting = targeting;
  }

  let stored = null;
  if (req.file) {
    if (notice.storageRef) await deleteStoredFile(notice).catch(() => null);
    stored = await storeStoredAttachment(req);
    notice.attachmentUrl = stored.fileUrl;
    notice.attachmentName = req.file.originalname;
    notice.storageProvider = stored.storageProvider;
    notice.storageRef = stored.storageRef;
  }

  await notice.save();

  if (stored) await queueAttachmentOptimization(notice, stored, req);

  if (!wasPublished && notice.status === 'published') notifyNotice(notice, req.user, 'NOTICE_CREATED');
  else if (wasPublished && notice.status === 'published') notifyNotice(notice, req.user, 'NOTICE_UPDATED');

  res.json({ success: true, data: notice });
});

export const deleteNotice = asyncHandler(async (req, res) => {
  const notice = await Notice.findById(req.params.id);
  if (!notice) throw new ApiError(404, 'Notice not found');
  assertManageAccess(notice, req.user);

  if (notice.storageRef) await deleteStoredFile(notice).catch(() => null);
  await notice.deleteOne();

  res.json({ success: true, message: 'Notice deleted' });
});

// GET /notices/mine — the creator's own notices, for management (edit/delete),
// regardless of publish/expiry window.
export const listMyNotices = asyncHandler(async (req, res) => {
  const filter = req.user.role === 'super_admin' || req.user.role === 'administrator' ? {} : { createdBy: req.user._id };
  const notices = await Notice.find(filter).populate(POPULATE).sort({ createdAt: -1 });
  res.json({ success: true, data: notices });
});

// GET /notices — the audience view: currently-published notices relevant to
// the requesting user (or public-everyone notices for anonymous visitors).
export const listRelevantNotices = asyncHandler(async (req, res) => {
  const now = new Date();
  const filter = {
    status: 'published',
    publishDate: { $lte: now },
    $and: [{ $or: [{ expiryDate: null }, { expiryDate: { $gte: now } }] }],
  };

  if (!req.user) {
    filter['targeting.everyone'] = true;
  } else if (req.user.role !== 'super_admin' && !(await isAdminTierRole(req.user.role))) {
    const effectiveCourseIds = await getEffectiveCourseIds(req.user);
    filter.$or = [
      { 'targeting.everyone': true },
      { 'targeting.departments': req.user.department },
      { 'targeting.batches': req.user.batch },
      { 'targeting.semesters': req.user.semester },
      { 'targeting.courses': { $in: effectiveCourseIds } },
    ];
  }
  // admin/super_admin viewing the audience feed (not /mine) see everything —
  // they aren't excluded from any targeting axis.

  const notices = await Notice.find(filter).populate(POPULATE).sort({ publishDate: -1 }).limit(50);
  res.json({ success: true, data: notices });
});
