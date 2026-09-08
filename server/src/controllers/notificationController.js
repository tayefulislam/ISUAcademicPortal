import Notification from '../models/Notification.js';
import PushSubscription from '../models/PushSubscription.js';
import { NOTIFICATION_TYPES } from '../models/Notification.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { getVapidPublicKey } from '../services/notifications/pushService.js';

// GET /notifications — own notifications only. `recipient` is ALWAYS taken
// from the authenticated session, never from a query param — a client can
// never read another user's notifications (spec §17).
export const listNotifications = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Number(req.query.limit) || 20);
  const filter = { recipient: req.user._id };
  if (req.query.unreadOnly === 'true') filter.isRead = false;

  const [items, total] = await Promise.all([
    Notification.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Notification.countDocuments(filter),
  ]);

  res.json({
    success: true,
    data: items,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const count = await Notification.countDocuments({ recipient: req.user._id, isRead: false });
  res.json({ success: true, data: { count } });
});

async function loadOwnNotification(id, user) {
  const notification = await Notification.findById(id);
  if (!notification) throw new ApiError(404, 'Notification not found');
  if (!notification.recipient.equals(user._id)) {
    throw new ApiError(403, 'You can only manage your own notifications', null, 'FORBIDDEN');
  }
  return notification;
}

export const markAsRead = asyncHandler(async (req, res) => {
  const notification = await loadOwnNotification(req.params.id, req.user);
  if (!notification.isRead) {
    notification.isRead = true;
    notification.readAt = new Date();
    await notification.save();
  }
  res.json({ success: true, data: notification });
});

export const markAllAsRead = asyncHandler(async (req, res) => {
  await Notification.updateMany({ recipient: req.user._id, isRead: false }, { isRead: true, readAt: new Date() });
  res.json({ success: true, message: 'All notifications marked as read' });
});

export const deleteNotification = asyncHandler(async (req, res) => {
  const notification = await loadOwnNotification(req.params.id, req.user);
  await notification.deleteOne();
  res.json({ success: true, message: 'Notification deleted' });
});

// ----- Preferences -----

export const getPreferences = asyncHandler(async (req, res) => {
  const prefs = req.user.notificationPreferences || {};
  const types = Object.fromEntries(
    NOTIFICATION_TYPES.filter((t) => t !== 'SYSTEM').map((t) => [t, prefs.types?.get?.(t) !== false])
  );
  res.json({ success: true, data: { push: prefs.push !== false, email: prefs.email !== false, types } });
});

export const updatePreferences = asyncHandler(async (req, res) => {
  const { push, email, types } = req.body;
  if (push !== undefined) req.user.notificationPreferences.push = !!push;
  if (email !== undefined) req.user.notificationPreferences.email = !!email;
  if (types && typeof types === 'object') {
    for (const [type, enabled] of Object.entries(types)) {
      // SYSTEM is mandatory — spec §12: never allow disabling required
      // security/system notifications, silently ignore any attempt to.
      if (type === 'SYSTEM' || !NOTIFICATION_TYPES.includes(type)) continue;
      req.user.notificationPreferences.types.set(type, !!enabled);
    }
  }
  await req.user.save();
  res.json({ success: true, message: 'Preferences updated' });
});

// ----- Push subscriptions -----

export const getVapidKey = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { publicKey: getVapidPublicKey() } });
});

function detectDeviceType(userAgent = '') {
  if (/ipad|tablet/i.test(userAgent)) return 'tablet';
  if (/mobi|iphone|android/i.test(userAgent)) return 'mobile';
  return 'desktop';
}

function detectBrowser(userAgent = '') {
  if (/edg\//i.test(userAgent)) return 'Edge';
  if (/chrome\//i.test(userAgent)) return 'Chrome';
  if (/firefox\//i.test(userAgent)) return 'Firefox';
  if (/safari\//i.test(userAgent) && !/chrome/i.test(userAgent)) return 'Safari';
  return 'Unknown';
}

function detectPlatform(userAgent = '') {
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS';
  if (/android/i.test(userAgent)) return 'Android';
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/mac os/i.test(userAgent)) return 'macOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  return 'Unknown';
}

// POST /notifications/subscribe — `user` is always req.user._id, never a
// client-supplied id (spec §17: never let a caller subscribe another user).
export const subscribe = asyncHandler(async (req, res) => {
  const { endpoint, keys } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new ApiError(400, 'A valid push subscription (endpoint + keys) is required');
  }
  const userAgent = req.body.userAgent || req.headers['user-agent'] || '';

  const subscription = await PushSubscription.findOneAndUpdate(
    { endpoint },
    {
      user: req.user._id,
      endpoint,
      keys: { p256dh: keys.p256dh, auth: keys.auth },
      deviceType: detectDeviceType(userAgent),
      browser: detectBrowser(userAgent),
      platform: detectPlatform(userAgent),
      userAgent,
      isActive: true,
      lastUsedAt: new Date(),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  res.status(201).json({ success: true, data: subscription });
});

// DELETE /notifications/subscribe { endpoint } — ownership-checked.
export const unsubscribe = asyncHandler(async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) throw new ApiError(400, 'endpoint is required');

  const subscription = await PushSubscription.findOne({ endpoint });
  if (subscription) {
    if (!subscription.user.equals(req.user._id)) {
      throw new ApiError(403, 'You can only manage your own push subscriptions', null, 'FORBIDDEN');
    }
    await subscription.deleteOne();
  }
  res.json({ success: true, message: 'Unsubscribed' });
});
