import mongoose from 'mongoose';

const courseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Not globally unique — the same course code can be offered by more than
    // one department (e.g. ENG-101 taught under both CSE and BBA). Uniqueness
    // is enforced per department via the compound index below instead.
    courseId: { type: String, required: true, uppercase: true, trim: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    description: { type: String, default: '' },
    credit: { type: Number, default: 3 },
    semester: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

courseSchema.index({ name: 'text', courseId: 'text' });
courseSchema.index({ department: 1 });
// A department can't have the same course code twice, but different
// departments can each offer their own "ENG-101", "CSE-203", etc.
courseSchema.index({ department: 1, courseId: 1 }, { unique: true });

export default mongoose.model('Course', courseSchema);
