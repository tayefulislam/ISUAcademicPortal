import mongoose from 'mongoose';
import Report, {
  REPORT_ENTITY_TYPES,
  REPORT_REASONS,
  REPORT_STATUSES,
  REPORT_PLATFORMS,
} from '../models/Report.js';
import File from '../models/File.js';
import Course from '../models/Course.js';
import Notice from '../models/Notice.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { parsePagination } from '../utils/pagination.js';
import { userCanAccessFile } from '../services/fileQueryBuilder.js';
import { emit } from '../services/notifications/notificationService.js';
import { resolveModerators } from '../services/notifications/recipientResolver.js';
import { logger } from '../utils/logger.js';

// Content moderation (Report/Flag). A signed-in user reports a piece of content
// they can actually reach; moderators (CR/Admin/Administrator/Super Admin) work
// the queue. The reporter's identity is only ever returned to moderators and to
// the reporter themselves — never in a public/listing response.

const isDuplicateKey = (err) => err?.code === 11000 || err?.err?.code === 11000;

/**
 * Loads the target and verifies the reporter may act on it. A user must only be
 * able to report content they can access — enforced with the same access rule
 * every read path uses (userCanAccessFile), never a client claim.
 * @returns {Promise<{ type: string, snapshot: object }>}
 */
async function resolveReportTarget(entityType, entityId, user) {
  if (!REPORT_ENTITY_TYPES.includes(entityType)) {
    throw new ApiError(400, `entityType must be one of: ${REPORT_ENTITY_TYPES.join(', ')}`);
  }
  if (!mongoose.isValidObjectId(entityId)) {
    throw new ApiError(400, 'A valid entityId is required');
  }

  if (entityType === 'FILE') {
    const file = await File.findById(entityId).populate('department', 'name code').populate('course', 'name courseId');
    if (!file) throw new ApiError(404, 'The reported material was not found');
    if (!(await userCanAccessFile(file, user))) {
      throw new ApiError(403, 'You can only report content you have access to', null, 'FORBIDDEN');
    }
    return {
      type: 'FILE',
      snapshot: {
        title: file.title,
        subtitle: [file.course?.name || file.courseName, file.departmentCode].filter(Boolean).join(' · '),
        url: `/files/${file._id}`,
      },
    };
  }

  if (entityType === 'COURSE') {
    const course = await Course.findById(entityId).populate('department', 'name code');
    if (!course) throw new ApiError(404, 'The reported course was not found');
    return {
      type: 'COURSE',
      snapshot: {
        title: course.name,
        subtitle: [course.courseId, course.department?.name].filter(Boolean).join(' · '),
        url: `/courses/${course._id}`,
      },
    };
  }

  if (entityType === 'NOTICE') {
    const notice = await Notice.findById(entityId);
    if (!notice) throw new ApiError(404, 'The reported notice was not found');
    return {
      type: 'NOTICE',
      snapshot: { title: notice.title || 'Notice', subtitle: '', url: '/notices' },
    };
  }

  // 'OTHER' — an id with no collection behind it (e.g. a message/comment id a
  // future feature introduces). Accepted as-is; there is nothing to verify.
  return { type: 'OTHER', snapshot: {} };
}

// Fire-and-forget: a notification failure must never fail the report itself.
function notifyModerators(report, reporter) {
  resolveModerators()
    .then((recipients) =>
      emit({
        type: 'CONTENT_REPORTED',
        actorId: reporter._id,
        entityType: 'REPORT',
        entityId: report._id,
        vars: {
          reporterName: reporter.name,
          entityType: report.entityType,
          reason: report.reason,
        },
        recipients,
      })
    )
    .catch((err) => logger.error(err, { source: 'reportController.notifyModerators' }));
}

// POST /reports — any authenticated user, any content they can reach.
export const createReport = asyncHandler(async (req, res) => {
  const { entityType, entityId, reason, description, platform } = req.body;

  if (!REPORT_REASONS.includes(reason)) {
    throw new ApiError(400, `reason must be one of: ${REPORT_REASONS.join(', ')}`);
  }
  if (!REPORT_PLATFORMS.includes(platform)) {
    throw new ApiError(400, `platform must be one of: ${REPORT_PLATFORMS.join(', ')}`);
  }

  const { type, snapshot } = await resolveReportTarget(entityType, entityId, req.user);

  let report;
  try {
    report = await Report.create({
      reporter: req.user._id,
      entityType: type,
      entityId,
      reason,
      description: description ? String(description).slice(0, 1000) : '',
      platform,
      snapshot,
    });
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw new ApiError(409, 'You have already reported this item', null, 'ALREADY_REPORTED');
    }
    throw err;
  }

  notifyModerators(report, req.user);

  res.status(201).json({ success: true, message: 'Report submitted — thank you', data: report });
});

// GET /reports/mine — the caller's own reports (no moderator-only fields).
export const listMyReports = asyncHandler(async (req, res) => {
  const reports = await Report.find({ reporter: req.user._id })
    .select('entityType entityId reason status createdAt updatedAt snapshot')
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({ success: true, data: reports });
});

// GET /reports — the moderation queue.
export const listReports = asyncHandler(async (req, res) => {
  const { status, entityType, reason, q } = req.query;
  const { page, limit, skip } = parsePagination(req.query);

  const filter = {};
  if (status) filter.status = status;
  if (entityType) filter.entityType = entityType;
  if (reason) filter.reason = reason;
  if (q) {
    const re = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ description: re }, { 'snapshot.title': re }, { 'snapshot.subtitle': re }];
  }

  const [items, total] = await Promise.all([
    Report.find(filter)
      .populate('reporter', 'name email rollNo')
      .populate('resolvedBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Report.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

export const getReport = asyncHandler(async (req, res) => {
  const report = await Report.findById(req.params.id)
    .populate('reporter', 'name email rollNo')
    .populate('resolvedBy', 'name');
  if (!report) throw new ApiError(404, 'Report not found');
  res.json({ success: true, data: report });
});

// PATCH /reports/:id/status — move a report through its lifecycle.
export const updateReportStatus = asyncHandler(async (req, res) => {
  const { status, resolutionNote } = req.body;
  if (!REPORT_STATUSES.includes(status)) {
    throw new ApiError(400, `status must be one of: ${REPORT_STATUSES.join(', ')}`);
  }

  const report = await Report.findById(req.params.id);
  if (!report) throw new ApiError(404, 'Report not found');

  report.status = status;
  if (resolutionNote !== undefined) {
    report.resolutionNote = String(resolutionNote || '').slice(0, 1000);
  }
  // A terminal state records who closed it and when; moving back to an open
  // state clears that, so the queue never shows a stale resolver.
  if (status === 'resolved' || status === 'rejected') {
    report.resolvedBy = req.user._id;
    report.resolvedAt = new Date();
  } else {
    report.resolvedBy = null;
    report.resolvedAt = null;
  }
  await report.save();

  // Tell the reporter their report moved — without ever showing them who else
  // reported, or any other reporter's identity.
  emit({
    type: 'REPORT_UPDATE',
    actorId: req.user._id,
    entityType: 'REPORT',
    entityId: report._id,
    slot: status,
    vars: { status },
    recipients: [report.reporter],
  }).catch((err) => logger.error(err, { source: 'reportController.updateReportStatus' }));

  res.json({ success: true, message: 'Report updated', data: report });
});

export const deleteReport = asyncHandler(async (req, res) => {
  const report = await Report.findByIdAndDelete(req.params.id);
  if (!report) throw new ApiError(404, 'Report not found');
  res.json({ success: true, message: 'Report deleted' });
});
