import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { NOTIFICATION_TYPES } from './Notification.js';

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
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', default: null },
    semester: { type: mongoose.Schema.Types.ObjectId, ref: 'Semester', default: null },

    favorites: [{ type: mongoose.Schema.Types.ObjectId, ref: 'File' }],

    status: { type: String, enum: ['active', 'blocked'], default: 'active' },

    // Gates access to restricted materials only — NOT login itself (a pending
    // student can still sign in and see public/login_required materials).
    // Defaults to 'approved' so existing users, and registrations made while
    // the approval system is OFF, are never accidentally locked out.
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'blocked'], default: 'approved' },
    // S3/R2 object key (or local relative path) for the private student-ID
    // photo, under a prefix never served publicly. Never sent to the client —
    // access goes through an authenticated proxy endpoint, keyed by user id.
    studentIdImageKey: { type: String, default: '' },

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
  delete obj.otpCodeHash;
  delete obj.otpExpiresAt;
  delete obj.passwordResetTokenHash;
  delete obj.passwordResetExpiresAt;
  return obj;
};

export default mongoose.model('User', userSchema);
