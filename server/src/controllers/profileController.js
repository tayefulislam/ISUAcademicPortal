import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const POPULATE = [
  { path: 'department', select: 'name code' },
  { path: 'batch', select: 'name code' },
  { path: 'semester', select: 'name code' },
];

export const getProfile = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate(POPULATE);
  res.json({ success: true, data: user.toSafeObject() });
});

// Self-service profile update. Deliberately whitelisted — email, role,
// status and tokenVersion can never be changed through this endpoint, no
// matter what the request body contains. The authenticated user can only
// ever update their own document (req.user._id comes from the verified
// token, never from the request body/params).
export const updateProfile = asyncHandler(async (req, res) => {
  const allowed = ['name', 'rollNo', 'department', 'batch', 'semester'];
  const update = {};
  for (const key of allowed) {
    if (req.body[key] === undefined) continue;
    update[key] = key === 'rollNo' ? String(req.body[key] || '').trim() : req.body[key] || null;
  }

  const user = await User.findByIdAndUpdate(req.user._id, update, {
    new: true,
    runValidators: true,
  }).populate(POPULATE);

  res.json({ success: true, message: 'Profile updated successfully', data: user.toSafeObject() });
});
