import mongoose from 'mongoose';

// A record of one broadcast send — the University Email System's history/
// dashboard reads straight off this collection. Targeting reuses the same
// shape/semantics as Notice.targeting (OR-across-axes, `everyone` overrides).
const emailLogSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },

    targeting: {
      everyone: { type: Boolean, default: false },
      departments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
      courses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
      batches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Batch' }],
      semesters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Semester' }],
      includeFaculty: { type: Boolean, default: false },
      recipientIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    },

    recipients: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        email: String,
        status: { type: String, enum: ['sent', 'failed'], default: 'sent' },
        error: { type: String, default: '' },
      },
    ],
    totalRecipients: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failCount: { type: Number, default: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

emailLogSchema.index({ createdBy: 1, createdAt: -1 });

export default mongoose.model('EmailLog', emailLogSchema);
