import mongoose from 'mongoose';

export const FEEDBACK_CATEGORIES = ['Website', 'Academic Material', 'Faculty', 'Technical Issue', 'Suggestion', 'App', 'Other'];
export const FEEDBACK_STATUSES = ['new', 'reviewed', 'resolved'];

const feedbackSchema = new mongoose.Schema(
  {
    // Open to anonymous/guest submitters too (name/email are collected on
    // the form itself), so `user` is an optional link for when the
    // submitter happens to be signed in — never required.
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    category: { type: String, enum: FEEDBACK_CATEGORIES, required: true },
    subject: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    rating: { type: Number, min: 1, max: 5, default: null },
    status: { type: String, enum: FEEDBACK_STATUSES, default: 'new' },
  },
  { timestamps: true }
);

feedbackSchema.index({ status: 1 });
feedbackSchema.index({ category: 1 });
feedbackSchema.index({ createdAt: -1 });

export default mongoose.model('Feedback', feedbackSchema);
