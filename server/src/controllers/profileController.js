import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { isAdminTierRole } from '../models/Role.js';

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
// Department/Batch are academic-record fields set at registration/enrollment
// time — a Student or a CR (still a student underneath, just promoted with
// extra permissions) must not be able to move themselves to a different
// department/batch through their own profile form. Every other field these
// two roles had before (name/rollNo/phone/semester) stays editable; every
// other role is unaffected.
async function resolveEditableFields(user) {
  const base = ['name', 'rollNo', 'phone', 'department', 'batch', 'semester'];
  const isCustomAdminTierRole = user.role !== 'admin' && (await isAdminTierRole(user.role));
  if (user.role === 'student' || isCustomAdminTierRole) {
    return base.filter((key) => key !== 'department' && key !== 'batch');
  }
  return base;
}

export const updateProfile = asyncHandler(async (req, res) => {
  const allowed = await resolveEditableFields(req.user);
  const update = {};
  for (const key of allowed) {
    if (req.body[key] === undefined) continue;
    update[key] = key === 'rollNo' || key === 'phone' ? String(req.body[key] || '').trim() : req.body[key] || null;
  }

  // rollNo doubles as the institution's Student ID — globally unique across
  // every department/batch (see models/User.js's unique index).
  if (update.rollNo) {
    const duplicate = await User.findOne({ rollNo: update.rollNo, _id: { $ne: req.user._id } });
    if (duplicate) {
      throw new ApiError(409, 'This Roll No / Student ID is already registered to another account');
    }
  }

  // Phone doubles as a login identifier too (authController.js's login()) —
  // same uniqueness guarantee as rollNo.
  if (update.phone) {
    if (!/^01\d{9}$/.test(update.phone)) {
      throw new ApiError(400, 'Phone number must be exactly 11 digits and start with 01');
    }
    const duplicatePhone = await User.findOne({ phone: update.phone, _id: { $ne: req.user._id } });
    if (duplicatePhone) {
      throw new ApiError(409, 'This phone number is already registered to another account');
    }
  }

  const user = await User.findByIdAndUpdate(req.user._id, update, {
    new: true,
    runValidators: true,
  }).populate(POPULATE);

  res.json({ success: true, message: 'Profile updated successfully', data: user.toSafeObject() });
});
