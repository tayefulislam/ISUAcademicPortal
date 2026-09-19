import mongoose from 'mongoose';

export const DELETION_REQUEST_STATUSES = ['pending', 'approved', 'rejected'];

// A user asking for their own account to be deleted.
//
// Google Play requires an app that creates accounts to offer deletion, both
// in-app and from a public web page. The request is REVIEWED rather than
// applied instantly: the university has legitimate academic records to keep
// (submissions, results, enrollments), so approval erases the person's
// identifying data and closes the account while those records stay.
const accountDeletionRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, default: '', trim: true, maxlength: 1000 },
    status: { type: String, enum: DELETION_REQUEST_STATUSES, default: 'pending', required: true },
    requestedAt: { type: Date, default: Date.now },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
    reviewNote: { type: String, default: '', trim: true, maxlength: 1000 },
    // Set when the account was actually anonymised and closed.
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

accountDeletionRequestSchema.index({ user: 1, status: 1 });
// The admin queue's query: everything still waiting for a decision.
accountDeletionRequestSchema.index({ status: 1, requestedAt: -1 });

export default mongoose.model('AccountDeletionRequest', accountDeletionRequestSchema);
