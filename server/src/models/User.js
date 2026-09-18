import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { NOTIFICATION_TYPES } from './Notification.js';
import { GROUP_BOTH } from './Settings.js';

// The 4 "fixed" roles baked into the app's core behavior (approval workflow,
// department/course scoping, unrestricted access). Beyond these, Super Admin
// can create further admin-tier roles at runtime (see models/Role.js) — so
// `role` is intentionally NOT a Mongoose enum; any of these 4, or any key
// from the Role collection, is valid. Controllers validate on write.
// 'administrator' has every super_admin capability except it cannot see,
// edit, or remove super_admin accounts, and only an actual super_admin can
// grant/revoke the 'administrator' role itself — see superAdminController.js.
export const USER_ROLES = ['student', 'faculty', 'admin', 'administrator', 'super_admin'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, default: 'student' },

    rollNo: { type: String, trim: true, default: '' },
    // Bangladeshi mobile format — exactly 11 digits, starting with "01" (e.g.
    // 01712345678). Also usable as a login identifier alongside email/rollNo
    // (see authController.js's login()).
    phone: { type: String, trim: true, default: '' },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', default: null },
    semester: { type: mongoose.Schema.Types.ObjectId, ref: 'Semester', default: null },
    // The student's class group within their batch (BOTH / A1 / A2 / ...).
    // The permitted values come from Settings.academicGroups rather than a
    // Mongoose enum, so a batch can be split further without a code change.
    // 'BOTH' is the default and means "the whole batch": every group-agnostic
    // routine entry is stored as BOTH, and a student whose own group is BOTH is
    // matched by entries for any group — which is what makes an unsplit batch
    // behave exactly as it always has.
    group: { type: String, default: GROUP_BOTH, uppercase: true, trim: true },

    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'File' }],

    status: { type: String, enum: ['active', 'blocked'], default: 'active' },

    // Gates access to restricted materials only — NOT login itself (a pending
    // student can still sign in and see public/login_required materials).
    // Defaults to 'approved' so existing users, and registrations made while
    // the approval system is OFF, are never accidentally locked out.
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'blocked'], default: 'approved' },
    // Audit trail for the approval/rejection decision — who, when, and in
    // what role (a CR's decision is worth distinguishing from an Admin's at
    // a glance). Set once by studentApprovalController.js's approveStudent/
    // rejectStudent, never by the client.
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    approvalRole: { type: String, default: '' },
    // Legacy pre-multi-provider storage ref — kept for backward compatibility
    // with records written before studentIdImage (below) existed. New writes
    // always populate studentIdImage instead; storageService.js/
    // studentApprovalController.js fall back to this only when
    // studentIdImage.key is empty. Never sent to the client.
    studentIdImageKey: { type: String, default: '' },
    // Provider-agnostic Student ID photo record — see storageService.js's
    // uploadStudentIdImage/deleteStudentIdImage. `key` is the deletion
    // credential (S3 object key or ImgBB delete_url) and must never reach the
    // client (stripped in toSafeObject below), even though the rest of this
    // subdocument is harmless metadata.
    studentIdImage: {
      provider: { type: String, enum: ['', 'imgbb', 's3'], default: '' },
      url: { type: String, default: '' },
      key: { type: String, default: '' },
      bucket: { type: String, default: '' },
      size: { type: Number, default: 0 },
      mimeType: { type: String, default: '' },
      uploadedAt: { type: Date, default: null },
    },
    // Reviewer-entered reason for the most recent rejection — cleared on
    // resubmission/approval so it never shows stale after a new decision.
    rejectionReason: { type: String, default: '' },
    // Workflow audit trail (SUBMITTED/REJECTED/RESUBMITTED/APPROVED) — purely
    // additive, appended by authController.js's register() and every action
    // in studentApprovalController.js. Never trims/loses old images by
    // itself; it's metadata only (see storageService.js for why old images
    // are actually deleted from storage on rejection/replacement).
    approvalHistory: [
      {
        action: { type: String, enum: ['SUBMITTED', 'REJECTED', 'RESUBMITTED', 'APPROVED', 'AUTO_APPROVED', 'MANUAL_OVERRIDE'], required: true },
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
        reason: { type: String, default: '' },
        performedAt: { type: Date, default: Date.now },
      },
    ],

    // Scopes review/management powers to these Department(s)/Course(s).
    // Meaningful for role 'faculty', and for any admin-tier Role (see
    // models/Role.js) other than the unrestricted 'admin' — e.g. a "CR"
    // reviews/approves only within their assigned scope. Empty for everyone
    // else (student, admin, super_admin).
    assignedDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
    assignedCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],

    lastLogin: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },

    // Bumped whenever a token-invalidating event happens (password change,
    // block/unblock, role change) — embedded in the JWT so old tokens issued
    // before the change stop being accepted immediately, without needing a
    // server-side session/refresh-token store.
    tokenVersion: { type: Number, default: 0 },

    // Only meaningful while Settings.otpVerificationEnabled is ON — defaults
    // true so existing accounts and registrations made while the toggle is
    // OFF are never retroactively locked out when it's turned on later.
    emailVerified: { type: Boolean, default: true },
    otpCodeHash: { type: String, default: '', select: false },
    otpExpiresAt: { type: Date, default: null, select: false },

    passwordResetTokenHash: { type: String, default: '', select: false },
    passwordResetExpiresAt: { type: Date, default: null, select: false },

    // Per-user notification opt-outs (Settings -> Notifications). `SYSTEM`
    // is intentionally not a toggleable key here — it's mandatory and always
    // delivered regardless of these preferences (see notificationService.js).
    notificationPreferences: {
      push: { type: Boolean, default: true },
      email: { type: Boolean, default: true },
      types: {
        type: Map,
        of: Boolean,
        default: () =>
          new Map(NOTIFICATION_TYPES.filter((t) => t !== 'SYSTEM').map((t) => [t, true])),
      },
    },
  },
  { timestamps: true }
);

// rollNo doubles as the institution's Student ID — globally unique across
// every department/batch, not just within one class (a CSE student and a
// BBA student can never share the same roll/student ID).
// MongoDB's partialFilterExpression only supports a small operator subset
// ($eq/$gt/$gte/$lt/$lte/$type/$exists/$and) — `$ne` is NOT one of them
// (it's internally a $not, which is rejected), so `$gt: ''` is used instead
// to mean "non-empty string" (any non-empty string sorts after ''). Using
// $ne here previously made MongoDB reject the index at creation time, which
// mongoose swallows silently unless something listens for the model's
// 'index' event — so this constraint was defined but never actually built
// or enforced. See the explicit pre-check in authController.js's register(),
// profileController.js's updateProfile(), and superAdminController.js's
// updateUserProfile() for the friendly, immediate version of this same rule.
userSchema.index({ rollNo: 1 }, { unique: true, partialFilterExpression: { rollNo: { $type: 'string', $gt: '' } } });

// Same partial-unique pattern as rollNo above (see that comment for why
// $gt:'' rather than $ne is required here) — a phone number, once set, must
// be unique too, since it doubles as a login identifier just like rollNo.
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string', $gt: '' } } });

// Audience lookup for the class routine: "who is in CSE / Batch 14 / Semester 1
// / group A1". The routine fan-out and the notification recipient resolver both
// start from exactly these four axes, so they share one index rather than each
// scanning the collection.
userSchema.index({ department: 1, batch: 1, semester: 1, group: 1 });

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.toSafeObject = function toSafeObject() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.tokenVersion;
  delete obj.studentIdImageKey;
  if (obj.studentIdImage) delete obj.studentIdImage.key;
  delete obj.otpCodeHash;
  delete obj.otpExpiresAt;
  delete obj.passwordResetTokenHash;
  delete obj.passwordResetExpiresAt;
  return obj;
};

export default mongoose.model('User', userSchema);
