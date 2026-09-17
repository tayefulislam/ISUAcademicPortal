import mongoose from 'mongoose';

export const TEACHING_STATUSES = ['active', 'deactivated'];

// Per-Faculty course state: "this faculty is currently running this class".
//
// Deliberately a pivot rather than a field on Course. Course.status is the
// global publish switch owned by Super Admin; if a faculty member deactivated a
// course by flipping that, the course would vanish for every other faculty
// member and for every student. Here, one faculty deactivating only affects
// their own list.
//
// There is no row until a faculty member first activates a course, and an
// absent row reads as `deactivated` — which is the required default, and needs
// no backfill.
const facultyCourseSchema = new mongoose.Schema(
  {
    faculty: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },

    status: { type: String, enum: TEACHING_STATUSES, default: 'deactivated' },
    activatedAt: { type: Date, default: null },

    // The batch this faculty member last worked in for this course, so "Add
    // content" can default to it instead of asking again.
    lastBatch: { type: mongoose.Schema.Types.ObjectId, ref: 'Batch', default: null },
  },
  { timestamps: true }
);

// One row per (faculty, course).
facultyCourseSchema.index({ faculty: 1, course: 1 }, { unique: true });
// The Active/Deactivated split in My Courses.
facultyCourseSchema.index({ faculty: 1, status: 1 });

export default mongoose.model('FacultyCourse', facultyCourseSchema);
