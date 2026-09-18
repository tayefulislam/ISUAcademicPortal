import crypto from 'crypto';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { signToken } from '../utils/jwt.js';
import { getSettings, FEATURE_FLAGS } from '../models/Settings.js';
import { getRole, PERMISSION_MODULES } from '../models/Role.js';
import { sendEmail } from '../services/email/emailService.js';
import { otpEmail, passwordResetEmail } from '../services/email/templates.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { emailDomainMatches, isOfficialUniversityEmail, getNextRequiredStep, NEXT_STEP } from '../services/registrationFlowService.js';
import { resolveGroup } from '../utils/groups.js';

// Re-exported so any existing import site (including tests) that imports
// these from authController.js keeps working — the actual implementation
// now lives in registrationFlowService.js, reused (not duplicated) by
// login()/verifyOtp()/register() below via getNextRequiredStep().
export { emailDomainMatches, isOfficialUniversityEmail };

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

// A person's placement, populated for the RESPONSE only — same convention as
// profileController and studentApprovalController. Unpopulated these are bare
// ObjectIds, and a client then has nothing human to show: the web's
// `user.batch?.name` is undefined (so the line silently disappears) and the
// Android app falls back to the raw id, which is the ObjectId a student saw on
// a course page and on their own profile.
//
// req.user deliberately keeps its raw refs: the rest of the server compares
// them as ids (audience targeting in the assignment/quiz/notice queries,
// approval scoping), where an object would silently match nothing.
const PLACEMENT_POPULATE = [
  { path: 'department', select: 'name code' },
  { path: 'batch', select: 'name code' },
  { path: 'semester', select: 'name code' },
];

async function responseUser(user) {
  const populated = await User.findById(user._id).populate(PLACEMENT_POPULATE);
  return (populated || user).toSafeObject();
}

// `settings` is optional — omit it only where the caller has no reasonable
// use for `nextStep` (there is no such call site left below, but keeping it
// optional avoids a hard crash if one is ever added without remembering).
async function withPermissions(user, settings) {
  return {
    ...(await responseUser(user)),
    permissions: await resolvePermissions(user),
    nextStep: settings ? getNextRequiredStep(user, settings) : undefined,
  };
}

function generateOtpCode() {
  return String(crypto.randomInt(100000, 999999));
}

// The single choke point for the auto-approval decision — called from
// register() (when OTP verification is globally OFF, so emailVerified is
// already true at account creation) and from verifyOtp() (when it's ON,
// right after a real OTP is confirmed). Reuses the EXISTING approvalStatus
// field/workflow (the same one Student ID review drives — see
// studentApprovalController.js) rather than adding a second parallel
// "account approved" flag: this only ever fires while that field is still
// 'pending', so it's just a different, automatic path to the same status a
// human reviewer would otherwise set, never a status human review can't
// also reach or override.
//
// Unconditional whenever the general studentApprovalEnabled system is ON —
// there is deliberately NO separate "auto-approval enabled" toggle. An
// earlier version had one, defaulted OFF, and that second toggle being left
// off was exactly why official-university-email students were getting
// stuck waiting for manual Student ID review despite a verified official
// email — the bug this function's current shape fixes.
//
// Every condition is re-checked against the DATABASE user record and
// server-side Settings — never anything the client sent (no
// `emailVerified`/`approved`/`approvalStatus` field in any request body is
// ever read here).
export async function maybeAutoApproveStudent(user, settings, req) {
  if (user.role !== 'student') return;
  if (user.approvalStatus !== 'pending') return; // nothing to auto-approve
  if (!user.emailVerified) return; // OTP/email verification is mandatory, never skippable
  if (!isOfficialUniversityEmail(user.email, settings)) return;

  user.approvalStatus = 'approved';
  user.approvedBy = null; // system-triggered, not a human reviewer
  user.approvedAt = new Date();
  user.approvalRole = 'system';
  user.rejectionReason = '';
  user.approvalHistory.push({ action: 'AUTO_APPROVED', performedBy: null, performedAt: new Date() });

  logger.info('Student auto-approved via verified university email', {
    req,
    source: 'studentId',
    meta: {
      action: 'AUTO_APPROVED',
      reason: 'VERIFIED_UNIVERSITY_EMAIL',
      emailDomain: settings.studentAutoApprovalDomain,
      userId: user._id,
    },
  });
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
  const { name, email, password, department, batch, semester, group, rollNo, phone } = req.body;

  // Normalized the same way the schema stores it (lowercase, trimmed) before
  // checking — two people typing "Name@Example.com" and "name@example.com"
  // must collide, matching the unique index on this field.
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw new ApiError(409, 'This email address is already registered. Please use another email or log in to your existing account.');
  }

  // rollNo doubles as the institution's Student ID — globally unique across
  // every department/batch (a CSE student and a BBA student can never share
  // one), matching the User model's own unique index on `rollNo` alone. This
  // is checked here explicitly so a duplicate is rejected with a clear
  // message immediately, rather than depending solely on that index (or a
  // 500/race if it's ever missing/rebuilding on a given deployment) — the
  // index (see models/User.js) is still the final authority against a
  // genuine race between two simultaneous registrations; see the
  // duplicate-key handling in middleware/errorHandler.js for that case.
  const trimmedRollNo = rollNo?.trim();
  if (trimmedRollNo) {
    const duplicateRollNo = await User.findOne({ rollNo: trimmedRollNo });
    if (duplicateRollNo) {
      throw new ApiError(409, 'This Student ID is already registered with another account. Please check your Student ID or contact the administrator.');
    }
  }

  // Phone is also usable as a login identifier (see login() below), so it
  // needs the same uniqueness guarantee/pre-check as rollNo/email.
  const trimmedPhone = phone?.trim();
  if (trimmedPhone) {
    const duplicatePhone = await User.findOne({ phone: trimmedPhone });
    if (duplicatePhone) {
      throw new ApiError(409, 'This phone number is already registered. Please use another phone number or log in to your existing account.');
    }
  }

  const settings = await getSettings();
  // Student ID (the verification photo) is NOT collected here — registration
  // only ever creates the account. Whether this student ends up needing to
  // submit one is decided after their email is verified (see
  // maybeAutoApproveStudent below and /student-id/submit in
  // studentApprovalController.js): an official-university-email student
  // never needs one at all; anyone else is routed to submit one
  // post-registration, not during it.
  const approvalStatus = settings.studentApprovalEnabled ? 'pending' : 'approved';

  // Public registration always creates a student account; admin/super_admin
  // are provisioned via the seed script or by an existing Super Admin.
  //
  // `group` is the class group within the batch (BOTH / A1 / A2 …). It decides
  // which half of the batch's timetable this student is shown, so it has to be
  // captured here: with everyone left on the BOTH default the group axis matches
  // nobody in particular and a group-split routine is invisible to all of them.
  // Optional in the body — an omitted value stays BOTH, so an older client keeps
  // registering — but validated against the configured list rather than stored
  // as sent, and normalised to upper case by resolveGroup.
  const user = await User.create({
    name,
    email,
    password,
    department: department || null,
    batch: batch || null,
    semester: semester || null,
    group: await resolveGroup(group),
    rollNo: trimmedRollNo || '',
    phone: trimmedPhone || '',
    role: 'student',
    approvalStatus,
    emailVerified: !settings.otpVerificationEnabled,
  });
  logger.info('Student registered', { req, source: 'studentId', meta: { userId: user._id, action: 'STUDENT_REGISTERED' } });

  if (settings.otpVerificationEnabled) {
    const code = generateOtpCode();
    user.otpCodeHash = hashSecret(code);
    user.otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
    await user.save({ validateBeforeSave: false });
    const { subject, html, text } = otpEmail(code);
    // Deliberately NOT awaited: the account is already created and the OTP
    // hash already saved above, so the request is otherwise done — the
    // frontend needs this response back immediately to navigate to the
    // verify-OTP screen. Awaiting this used to mean a slow/unreachable SMTP
    // server (e.g. a blocked port from the hosting provider) left the whole
    // registration request hanging for nodemailer's ~2-minute connection
    // timeout, which looked like a stuck "Creating..." button even though
    // the account had already been created. A delivery failure here is
    // logged, never thrown into the response — the user can always use
    // "Resend code" (sendOtp below) once the mail issue is fixed.
    sendEmail({ to: user.email, subject, html, text }).catch((err) =>
      logger.error(err, { req, source: 'authController.register', meta: { userId: user._id, action: 'OTP_EMAIL_FAILED' } })
    );
  } else {
    // No OTP step exists in this configuration — emailVerified is already
    // true from the moment the account was created above, so this is the
    // right (and only) place to run the auto-approval check for this path.
    // When OTP IS enabled, emailVerified is still false here and this is a
    // guaranteed no-op — the real check for that path runs in verifyOtp().
    await maybeAutoApproveStudent(user, settings, req);
    if (user.isModified()) await user.save({ validateBeforeSave: false });
  }

  // While OTP verification is required, no token is issued yet — the client
  // must call verify-otp first, which signs and returns the first token.
  const token = settings.otpVerificationEnabled ? null : signToken(user);
  const nextStep = getNextRequiredStep(user, settings);
  res.status(201).json({
    success: true,
    message: settings.otpVerificationEnabled
      ? 'Account created — check your email for a verification code'
      : user.approvalStatus === 'approved' && approvalStatus === 'pending'
        ? 'Account created — your student account has been automatically approved'
        : approvalStatus === 'pending'
          ? 'Account created — please submit your Student ID to complete verification'
          : 'Account created',
    // `nextStep` is the single value the frontend should route on — see
    // registrationFlowService.js's getNextRequiredStep for the full decision
    // tree. `requiresOtp` is kept alongside it for any existing call site
    // that only checks that boolean.
    data: { user: await responseUser(user), token, requiresOtp: settings.otpVerificationEnabled, nextStep },
  });
});

// Signing in accepts email, Student ID (rollNo), or phone number — all in
// the one `identifier` field — since a student may not always remember
// which one they registered/are expected to use. Matched as: email
// case-insensitively (mirrors its lowercase-on-save storage), rollNo/phone
// as exact strings (neither is lowercased). The empty-string guard below
// keeps this correct even if ever called without going through the route's
// own express-validator notEmpty() check — see that guard's own comment.
//
// Super Admin can turn rollNo/phone login off independently
// (Settings.studentIdLoginEnabled / phoneLoginEnabled, both default ON) —
// when off, that identifier is never matched at login even though it's
// still stored on the account (e.g. still usable for e.g. contact info or
// re-enabled later), so a user can't work around the toggle by just typing
// their disabled identifier.
export const login = asyncHandler(async (req, res) => {
  const { identifier, password } = req.body;
  const cleaned = String(identifier || '').trim();
  // Never trust the route's express-validator notEmpty() check alone here —
  // an empty `cleaned` would otherwise build a query matching rollNo/phone's
  // own blank ('') schema default, i.e. any account that has never set
  // either, rather than matching nothing as intended.
  if (!cleaned) throw new ApiError(401, 'Invalid credentials');

  const settings = await getSettings();

  const or = [{ email: cleaned.toLowerCase() }];
  if (settings.studentIdLoginEnabled) or.push({ rollNo: cleaned });
  if (settings.phoneLoginEnabled) or.push({ phone: cleaned });

  const user = await User.findOne({ $or: or }).select('+password');
  if (!user || !(await user.comparePassword(password))) {
    throw new ApiError(401, 'Invalid credentials');
  }
  if (user.status === 'blocked') {
    throw new ApiError(403, 'Your account has been blocked', null, 'FORBIDDEN');
  }

  if (settings.otpVerificationEnabled && !user.emailVerified) {
    throw new ApiError(403, 'Please verify your email before logging in', null, 'EMAIL_NOT_VERIFIED');
  }

  user.lastLogin = new Date();
  user.lastLoginIp = req.ip;
  await user.save({ validateBeforeSave: false });

  const token = signToken(user);
  res.json({ success: true, message: 'Signed in', data: { user: await withPermissions(user, settings), token } });
});

export const me = asyncHandler(async (req, res) => {
  const settings = await getSettings();
  res.json({ success: true, data: { user: await withPermissions(req.user, settings) } });
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
    // Fire-and-forget — see register()'s identical comment for why.
    sendEmail({ to: user.email, subject, html, text }).catch((err) =>
      logger.error(err, { req, source: 'authController.sendOtp', meta: { userId: user._id, action: 'OTP_EMAIL_FAILED' } })
    );
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
  user.lastLoginIp = req.ip;
  logger.info('Email verified via OTP', { req, source: 'studentId', meta: { userId: user._id, action: 'EMAIL_VERIFIED' } });

  const settings = await getSettings();
  const wasPending = user.approvalStatus === 'pending';
  await maybeAutoApproveStudent(user, settings, req);
  const autoApproved = wasPending && user.approvalStatus === 'approved';

  await user.save({ validateBeforeSave: false });

  const token = signToken(user);
  const nextStep = getNextRequiredStep(user, settings);
  const requiresStudentId = nextStep === NEXT_STEP.STUDENT_ID_SUBMISSION || nextStep === NEXT_STEP.WAITING_FOR_APPROVAL;
  res.json({
    success: true,
    message: autoApproved
      ? 'Email verified successfully. Your student account has been automatically approved.'
      : requiresStudentId
        ? 'Email verified. Your email is not an official university email — please submit your Student ID to complete verification.'
        : 'Email verified',
    data: { user: await withPermissions(user, settings), token, autoApproved, requiresStudentId },
  });
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
    // Fire-and-forget — see register()'s identical comment for why.
    sendEmail({ to: user.email, subject, html, text }).catch((err) =>
      logger.error(err, { req, source: 'authController.forgotPassword', meta: { userId: user._id, action: 'RESET_EMAIL_FAILED' } })
    );
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
