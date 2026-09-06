import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

export const USER_ROLES = ['student', 'faculty', 'admin', 'super_admin'];

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: USER_ROLES, default: 'student' },

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

    // Only meaningful for role 'faculty' — scopes their review/management
    // powers to these Department(s)/Course(s). Empty for everyone else.
    assignedDepartments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
    assignedCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],

    lastLogin: { type: Date, default: null },

    // Bumped whenever a token-invalidating event happens (password change,
    // block/unblock, role change) — embedded in the JWT so old tokens issued
    // before the change stop being accepted immediately, without needing a
    // server-side session/refresh-token store.
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Roll numbers only need to be unique within the same department + batch —
// two different classes can both have a "1", "2", "3" ... sequence.
userSchema.index(
  { department: 1, batch: 1, rollNo: 1 },
  { unique: true, partialFilterExpression: { rollNo: { $type: 'string', $ne: '' } } }
);

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
  return obj;
};

export default mongoose.model('User', userSchema);
