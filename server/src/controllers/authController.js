import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { signToken } from '../utils/jwt.js';
import { getSettings } from '../models/Settings.js';
import { storePrivateImage } from '../services/storage/storageService.js';

export const getPublicSettings = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  res.json({ success: true, data: { studentApprovalEnabled: settings.studentApprovalEnabled } });
});

export const register = asyncHandler(async (req, res) => {
  // Only these fields are ever read from the request — role/status/tokenVersion
  // are never accepted from the client, no matter what the body contains.
  const { name, email, password, department, batch, semester, rollNo } = req.body;

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    throw new ApiError(409, 'An account with this email already exists');
  }

  const settings = await getSettings();
  let studentIdImageKey = '';
  let approvalStatus = 'approved';

  if (settings.studentApprovalEnabled) {
    if (!req.file) {
      throw new ApiError(400, 'A Student ID photo is required while the approval system is enabled');
    }
    studentIdImageKey = await storePrivateImage(req.file.buffer, req.file.originalname);
    approvalStatus = 'pending';
  }

  // Public registration always creates a student account; admin/super_admin
  // are provisioned via the seed script or by an existing Super Admin.
  const user = await User.create({
    name,
    email,
    password,
    department: department || null,
    batch: batch || null,
    semester: semester || null,
    rollNo: rollNo || '',
    role: 'student',
    studentIdImageKey,
    approvalStatus,
  });

  const token = signToken(user);
  res.status(201).json({
    success: true,
    message: approvalStatus === 'pending' ? 'Account created, pending admin approval' : 'Account created',
    data: { user: user.toSafeObject(), token },
  });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'Invalid email or password');
  }
  if (user.status === 'blocked') {
    throw new ApiError(403, 'Your account has been blocked', null, 'FORBIDDEN');
  }

  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  const token = signToken(user);
  res.json({ success: true, message: 'Signed in', data: { user: user.toSafeObject(), token } });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: req.user.toSafeObject() } });
});

export const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword, confirmNewPassword } = req.body;

  if (newPassword !== confirmNewPassword) {
    throw new ApiError(422, 'New password and confirmation do not match', null, 'VALIDATION_ERROR');
  }

  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(currentPassword))) {
    throw new ApiError(401, 'Current password is incorrect');
  }

  user.password = newPassword;
  user.tokenVersion += 1; // invalidates every token issued before this change
  await user.save();

  const token = signToken(user);
  res.json({ success: true, message: 'Password changed successfully', data: { token } });
});
