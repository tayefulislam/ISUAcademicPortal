import mongoose from 'mongoose';

export const ASSIGNMENT_STATUSES = ['draft', 'published', 'closed'];
export const SUBMISSION_TYPES = ['file', 'text', 'both'];

const attachmentSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    storageProvider: { type: String, required: true },
    storageRef: { type: String, default: '' },
  },
  { _id: true }
);

const assignmentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },

    // Targeting — AND across non-empty axes, OR within an axis's array
    // (identical semantics to File.restrictions): an assignment reaches
    // exactly the intersection of the groups picked, e.g. CSE + Data
    // Structure + BATCH-14 + 3rd Semester all at once, not any-of.
    departments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
    courses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
    batches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Batch' }],
    semesters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Semester' }],

    startDate: { type: Date, default: Date.now },
    deadline: { type: Date, required: true },

    attachments: [attachmentSchema],

    maxMarks: { type: Number, required: true, min: 0 },
    submissionType: { type: String, enum: SUBMISSION_TYPES, default: 'file' },
    allowResubmission: { type: Boolean, default: true },

    // 'draft' = not visible to students at all. 'published' = visible,
    // accepting submissions. 'closed' = visible (so marks/feedback still
    // show) but no longer accepts new/replacement submissions.
    status: { type: String, enum: ASSIGNMENT_STATUSES, default: 'draft' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

assignmentSchema.index({ status: 1 });
assignmentSchema.index({ departments: 1 });
assignmentSchema.index({ courses: 1 });
assignmentSchema.index({ batches: 1 });
assignmentSchema.index({ semesters: 1 });
assignmentSchema.index({ createdBy: 1 });
assignmentSchema.index({ deadline: 1 });

export default mongoose.model('Assignment', assignmentSchema);
