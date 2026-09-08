import mongoose from 'mongoose';

export const ENROLLMENT_TYPES = ['regular', 'retake', 'extra', 'backlog', 'improvement', 'advance'];
// Students may only ever request these — 'regular' is administrative-only
// (direct-create or bulk-regular), never student-self-requested.
export const STUDENT_REQUESTABLE_TYPES = ['retake', 'extra', 'backlog', 'improvement', 'advance'];

export const ENROLLMENT_STATUSES = ['pending', 'approved', 'active', 'completed', 'dropped', 'rejected'];
// Only these statuses grant actual course access — see services/courseAccessService.js.
export const ACCESS_GRANTING_STATUSES = ['active', 'approved'];

const historyEntrySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    timestamp: { type: Date, default: Date.now },
    previousStatus: { type: String, default: null },
    newStatus: { type: String, required: true },
    reason: { type: String, default: '' },
  },
  { _id: false }
);

// A student's course access is NOT determined solely by Department/Batch/
// Semester (see User.js) — this collection is the explicit enrollment layer
// sitting between Student and Course. 'regular' enrollments are just as
// explicit here as the additional types (retake/extra/backlog/improvement/
// advance); they're created administratively (direct-create or
// POST /course-enrollments/bulk-regular) rather than requested by students.
const courseEnrollmentSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    enrollmentType: { type: String, enum: ENROLLMENT_TYPES, required: true },
    status: { type: String, enum: ENROLLMENT_STATUSES, required: true, default: 'pending' },

    academicYear: { type: String, required: true, trim: true },
    // The semester this enrollment is FOR — independent of the student's own
    // current semester (a retake/backlog is deliberately taken "out of sync").
    semester: { type: mongoose.Schema.Types.ObjectId, ref: 'Semester', required: true },
    // Snapshot of the student's batch at enrollment time, for reporting/
    // filtering — not re-derived from the live User document later.
    batch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', default: null },

    reason: { type: String, default: '', trim: true, maxlength: 1000 },

    registeredAt: { type: Date, default: Date.now },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },

    // Mirrors `status in ['pending','approved','active']` — kept in sync by
    // the pre-save hook below. MongoDB's partialFilterExpression only
    // supports simple equality (not $in), so this flag is what the unique
    // index below actually filters on.
    isOpenEnrollment: { type: Boolean, default: true },

    history: [historyEntrySchema],
  },
  { timestamps: true }
);

const OPEN_STATUSES = new Set(['pending', 'approved', 'active']);
courseEnrollmentSchema.pre('save', function syncOpenFlag(next) {
  this.isOpenEnrollment = OPEN_STATUSES.has(this.status);
  next();
});

courseEnrollmentSchema.index({ student: 1, course: 1 });
courseEnrollmentSchema.index({ student: 1, status: 1 });
courseEnrollmentSchema.index({ student: 1, enrollmentType: 1 });
courseEnrollmentSchema.index({ course: 1, status: 1 });

// Only one OPEN (pending/approved/active) enrollment per student+course at a
// time — completed/dropped/rejected rows never count, so a failed regular
// attempt can always be followed by a new retake request (see the
// CSE301 Attempt 1 (regular, failed) -> Attempt 2 (retake, passed) example).
courseEnrollmentSchema.index(
  { student: 1, course: 1 },
  {
    unique: true,
    partialFilterExpression: { isOpenEnrollment: true },
    name: 'unique_open_enrollment_per_student_course',
  }
);

export default mongoose.model('CourseEnrollment', courseEnrollmentSchema);
