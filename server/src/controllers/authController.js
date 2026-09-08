import crypto from 'crypto';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { signToken } from '../utils/jwt.js';
import { getSettings, FEATURE_FLAGS } from '../models/Settings.js';
import { getRole, PERMISSION_MODULES } from '../models/Role.js';
import { storePrivateImage } from '../services/storage/storageService.js';
import { sendEmail } from '../services/email/emailService.js';
import { otpEmail, passwordResetEmail } from '../services/email/templates.js';
import { env } from '../config/env.js';

const OTP_TTL_MS = 10 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;

function hashSecret(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// super_admin and administrator implicitly have every admin-tier permission;
// student/faculty aren't part of this system (their menus/access are
// role-gated directly, unaffected by it) so they resolve to an empty list.
// Everyone else (Admin, CR, any further role Super Admin creates) gets
// exactly what's stored on their Role document — this is what the client
// uses to show/hide the admin-tier menu items and know which actions are
// worth attempting.
async function resolvePermissions(user) {
  if (user.role === 'super_admin' || user.role === 'administrator') return PERMISSION_MODULES.map((m) => m.key);
  if (user.role === 'student' || user.role === 'faculty') return [];
  const role = await getRole(user.role);
  return role ? role.permissions : [];
}

async function withPermissions(user) {
  return { ...user.toSafeObject(), permissions: await resolvePermissions(user) };
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 999999));
}

// Public (unauthenticated) read of feature toggles — client pages use this
// to show/hide gated UI (registration photo requirement, Submit Material,
// Feedback form, etc). Never exposes anything beyond the boolean flags.
export const getPublicSettings = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  const data = Object.fromEntries(FEATURE_FLAGS.map((f) => [f.key, !!settings[f.key]]));
  res.json({ success: true, data });
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
    emailVerified: !settings.otpVerificationEnabled,
  });

  if (settings.otpVerificationEnabled) {
    const code = generateOtpCode();
    user.otpCodeHash = hashSecret(code);
    user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
    await user.save({ validateBeforeSave: false });
    const { subject, html, text } = otpEmail(code);
    await sendEmail({ to: user.email, subject, html, text });
  }

  // While OTP verification is required, no token is issued yet — the client
  // must call verify-otp first, which signs and returns the first token.
  const token = settings.otpVerificationEnabled ? null : signToken(user);
  res.status(201).json({
    success: true,
    message: settings.otpVerificationEnabled
      ? 'Account created — check your email for a verification code'
      : approvalStatus === 'pending'
        ? 'Account created, pending admin approval'
        : 'Account created',
    data: { user: user.toSafeObject(), token, requiresOtp: settings.otpVerificationEnabled },
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

  const settings = await getSettings();
  if (settings.otpVerificationEnabled && !user.emailVerified) {
    throw new ApiError(403, 'Please verify your email before logging in', null, 'EMAIL_NOT_VERIFIED');
  }

  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  const token = signToken(user);
  res.json({ success: true, message: 'Signed in', data: { user: await withPermissions(user), token } });
});

export const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: await withPermissions(req.user) } });
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

// ----- Email OTP verification -----

export const sendOtp = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  if (!settings.otpVerificationEnabled) {
    throw new ApiError(403, 'Email verification is currently disabled', null, 'FORBIDDEN');
  }

  const { email } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() });
  // Same generic response whether or not the account exists, and whether or
  // not it's already verified — avoids leaking account existence by timing
  // or response shape.
  if (user && !user.emailVerified) {
    const code = generateOtpCode();
    user.otpCodeHash = hashSecret(code);
    user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
    await user.save({ validateBeforeSave: false });
    const { subject, html, text } = otpEmail(code);
    await sendEmail({ to: user.email, subject, html, text });
  }

  res.json({ success: true, message: 'If an account needs verification, a code has been sent to that email' });
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const { email, code } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() }).select('+otpCodeHash +otpExpiresAt');

  if (
    !user ||
    !user.otpCodeHash ||
    !user.otpExpiresAt ||
    user.otpExpiresAt < new Date() ||
    user.otpCodeHash !== hashSecret(String(code))
  ) {
    throw new ApiError(400, 'Invalid or expired verification code', null, 'INVALID_OTP');
  }

  user.emailVerified = true;
  user.otpCodeHash = '';
  user.otpExpiresAt = null;
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  const token = signToken(user);
  res.json({ success: true, message: 'Email verified', data: { user: await withPermissions(user), token } });
});

// ----- Password reset -----

export const forgotPassword = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  if (!settings.passwordResetEnabled) {
    throw new ApiError(403, 'Password reset is currently disabled', null, 'FORBIDDEN');
  }

  const { email } = req.body;
  const user = await User.findOne({ email: email.toLowerCase() });

  // Always respond the same way regardless of whether the account exists.
  if (user && user.status !== 'blocked') {
    const rawToken = crypto.randomBytes(32).toString('hex');
    user.passwordResetTokenHash = hashSecret(rawToken);
    user.passwordResetExpiresAt = new Date(Date.now() + RESET_TTL_MS);
    await user.save({ validateBeforeSave: false });

    const resetUrl = `${env.clientUrls[0]}/reset-password?token=${rawToken}`;
    const { subject, html, text } = passwordResetEmail(resetUrl);
    await sendEmail({ to: user.email, subject, html, text });
  }

  res.json({ success: true, message: 'If an account exists for that email, a reset link has been sent' });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword, confirmNewPassword } = req.body;
  if (newPassword !== confirmNewPassword) {
    throw new ApiError(422, 'New password and confirmation do not match', null, 'VALIDATION_ERROR');
  }

  const tokenHash = hashSecret(token);
  const user = await User.findOne({
    passwordResetTokenHash: tokenHash,
    passwordResetExpiresAt: { $gt: new Date() },
  }).select('+passwordResetTokenHash +passwordResetExpiresAt');

  if (!user) {
    throw new ApiError(400, 'This reset link is invalid or has expired', null, 'INVALID_RESET_TOKEN');
  }

  user.password = newPassword;
  user.passwordResetTokenHash = '';
  user.passwordResetExpiresAt = null;
  user.tokenVersion += 1; // invalidates every token issued before this reset
  await user.save();

  const signedToken = signToken(user);
  res.json({ success: true, message: 'Password reset successfully', data: { token: signedToken } });
});
