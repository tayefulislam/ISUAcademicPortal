import mongoose from 'mongoose';

// There is no persisted 'not_submitted' state — that's simply the absence
// of a Submission document for a given (assignment, student) pair, computed
// at read time. 'late' vs 'submitted' is decided once, at submit time,
// against the assignment's deadline; grading flips it to 'graded'.
export const SUBMISSION_STATUSES = ['submitted', 'late', 'graded'];

const attachmentSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    fileUrl: { type: String, required: true },
    storageProvider: { type: String, required: true },
    storageRef: { type: String, default: '' },
  },
  { _id: true }
);

const submissionSchema = new mongoose.Schema(
  {
    assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    text: { type: String, default: '' },
    attachments: [attachmentSchema],

    submittedAt: { type: Date, default: Date.now },
    status: { type: String, enum: SUBMISSION_STATUSES, default: 'submitted' },

    marks: { type: Number, default: null },
    feedback: { type: String, default: '' },
    gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    gradedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One submission per student per assignment — resubmitting replaces this
// same document rather than creating a new one.
submissionSchema.index({ assignment: 1, student: 1 }, { unique: true });

export default mongoose.model('Submission', submissionSchema);
