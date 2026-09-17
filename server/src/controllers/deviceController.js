import UserDevice from '../models/UserDevice.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

// FCM registration tokens are long opaque strings; this is a sanity floor, not a
// format check (the format is Firebase's to change).
const MIN_TOKEN_LENGTH = 20;
const PLATFORMS = ['android', 'ios', 'web'];

function readToken(body) {
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new ApiError(400, 'A valid FCM registration token is required');
  }
  return token;
}

// POST /devices/register { token, platform, appVersion, deviceModel }
//
// `user` is always req.user._id — a caller can only ever register a device
// against their own account, never someone else's.
//
// Upsert by token, not by (user, token): a token identifies one physical install.
// Re-registering it (app restarted, token refreshed onto the same row, or the
// device signed into a different account) must update that one row rather than
// accumulate duplicates — which is also how "replace the previous device token"
// and "do not overwrite the user's other devices" are both satisfied at once.
export const registerDevice = asyncHandler(async (req, res) => {
  const token = readToken(req.body);
  const platform = PLATFORMS.includes(req.body?.platform) ? req.body.platform : 'android';
  const appVersion = String(req.body?.appVersion || '').slice(0, 40);
  const deviceModel = String(req.body?.deviceModel || '').slice(0, 80);

  const existing = await UserDevice.findOne({ fcmToken: token }).select('user');
  const movedFromAnotherUser = existing && !existing.user.equals(req.user._id);

  const device = await UserDevice.findOneAndUpdate(
    { fcmToken: token },
    {
      $set: {
        user: req.user._id,
        platform,
        appVersion,
        deviceModel,
        isActive: true,
        lastSeenAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (movedFromAnotherUser) {
    // Expected when a shared device switches accounts (sign out, sign in as
    // someone else) — logged because it is also what a token-stealing attempt
    // would look like, and nothing else in the system would record it.
    console.warn(`[devices] FCM token re-pointed from user ${existing.user} to ${req.user._id}`);
  }

  res.status(201).json({
    success: true,
    message: 'Device registered',
    data: { _id: device._id, platform: device.platform, isActive: device.isActive },
  });
});

// POST /devices/unregister { token }
//
// Called on sign-out. Deactivates rather than deletes, and is ownership-checked,
// so one user can never unregister another user's device. Deliberately
// idempotent: an unknown token is a success, because the client's logout must
// never fail or stall because the device was already cleaned up elsewhere.
export const unregisterDevice = asyncHandler(async (req, res) => {
  const token = readToken(req.body);

  const device = await UserDevice.findOne({ fcmToken: token });
  if (device) {
    if (!device.user.equals(req.user._id)) {
      throw new ApiError(403, 'You can only manage your own devices', null, 'FORBIDDEN');
    }
    if (device.isActive) {
      device.isActive = false;
      device.lastSeenAt = new Date();
      await device.save();
    }
  }

  res.json({ success: true, message: 'Device unregistered' });
});

// GET /devices — the caller's own registrations, for Settings/debugging. Never
// returns another user's devices, and never returns the raw token list to a
// non-owner (the token is what grants delivery, so it is treated as a secret).
export const listDevices = asyncHandler(async (req, res) => {
  const devices = await UserDevice.find({ user: req.user._id }).sort({ lastSeenAt: -1 });
  res.json({
    success: true,
    data: devices.map((d) => ({
      _id: d._id,
      platform: d.platform,
      appVersion: d.appVersion,
      deviceModel: d.deviceModel,
      isActive: d.isActive,
      lastSeenAt: d.lastSeenAt,
      createdAt: d.createdAt,
    })),
  });
});
