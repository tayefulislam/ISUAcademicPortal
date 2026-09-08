import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { emit } from '../services/notifications/notificationService.js';
import {
  resolveSingleUser,
  resolveCourseScopedRecipients,
  resolveDepartmentRecipients,
  resolveAllEligibleUsers,
} from '../services/notifications/recipientResolver.js';

// GET /admin/notifications/stats — counts by type and read-state, for the
// Admin -> Notifications dashboard (spec §20).
export const getStats = asyncHandler(async (req, res) => {
  const [byType, readState, total] = await Promise.all([
    Notification.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    Notification.aggregate([{ $group: { _id: '$isRead', count: { $sum: 1 } } }]),
    Notification.countDocuments(),
  ]);

  res.json({
    success: true,
    data: {
      total,
      byType: byType.map((t) => ({ type: t._id, count: t.count })),
      unread: readState.find((r) => r._id === false)?.count || 0,
      read: readState.find((r) => r._id === true)?.count || 0,
    },
  });
});

// GET /admin/notifications/logs — recent notifications across all users, for
// inspecting delivery (spec §20 "view delivery status / failed notifications").
export const listLogs = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Number(req.query.limit) || 50);
  const filter = {};
  if (req.query.type) filter.type = req.query.type;

  const [items, total] = await Promise.all([
    Notification.find(filter)
      .populate('recipient', 'name email role')
      .populate('sender', 'name email role')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Notification.countDocuments(filter),
  ]);

  res.json({ success: true, data: items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
});

// POST /admin/notifications/send — the only endpoint that can target
// arbitrary users; gated to super_admin/administrator (or a Role granted
// the 'notifications' permission — see PERMISSION_MODULES) at the route level.
export const sendNotification = asyncHandler(async (req, res) => {
  const { scope, targetId, title, message, url } = req.body;
  if (!title || !message) throw new ApiError(400, 'title and message are required');

  let recipients = [];
  switch (scope) {
    case 'user': {
      if (!targetId) throw new ApiError(400, 'targetId (userId) is required for scope "user"');
      const target = await User.findById(targetId);
      if (!target) throw new ApiError(404, 'User not found');
      recipients = resolveSingleUser(target._id);
      break;
    }
    case 'course': {
      if (!targetId) throw new ApiError(400, 'targetId (courseId) is required for scope "course"');
      recipients = await resolveCourseScopedRecipients({ course: targetId });
      break;
    }
    case 'department': {
      if (!targetId) throw new ApiError(400, 'targetId (departmentId) is required for scope "department"');
      recipients = await resolveDepartmentRecipients(targetId);
      break;
    }
    case 'all':
      recipients = await resolveAllEligibleUsers();
      break;
    default:
      throw new ApiError(400, 'scope must be one of: user, course, department, all');
  }

  if (!recipients.length) throw new ApiError(400, 'No recipients match this target');

  const result = await emit({
    type: 'SYSTEM',
    actorId: req.user._id,
    entityType: 'ADMIN_BROADCAST',
    vars: { title, message, url: url || '' },
    recipients,
  });

  res.status(201).json({ success: true, message: `Sent to ${result.created}/${recipients.length} recipient(s)`, data: result });
});
