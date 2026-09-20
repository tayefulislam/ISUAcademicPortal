import mongoose from 'mongoose';

// What can be reported. Kept as a small enum because the reporter's reference
// (entityId) has to be interpreted against it — a bare ObjectId is meaningless
// without knowing which collection it belongs to.
export const REPORT_ENTITY_TYPES = ['FILE', 'COURSE', 'NOTICE', 'OTHER'];

// The categories a reporter chooses from. Deliberately a closed list so a
// moderation queue can be filtered/grouped reliably, with 'Other' + a free-text
// description as the escape hatch.
export const REPORT_REASONS = [
  'Inappropriate',
  'Incorrect',
  'Broken',
  'Spam',
  'Copyright',
  'Other',
];

// The moderation lifecycle. 'pending' is the landing state; a moderator moves it
// to 'reviewing' while looking into it and closes it as 'resolved' (action
// taken) or 'rejected' (no action warranted).
export const REPORT_STATUSES = ['pending', 'reviewing', 'resolved', 'rejected'];

// Which client submitted it — so support can tell an app-only bug from a web one.
export const REPORT_PLATFORMS = ['web', 'android'];

const reportSchema = new mongoose.Schema(
  {
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    entityType: { type: String, enum: REPORT_ENTITY_TYPES, required: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true },

    reason: { type: String, enum: REPORT_REASONS, required: true },
    description: { type: String, default: '', trim: true, maxlength: 1000 },
    platform: { type: String, enum: REPORT_PLATFORMS, required: true },

    status: { type: String, enum: REPORT_STATUSES, default: 'pending' },

    // A small, denormalised copy of what was reported (title/subtitle/url) taken
    // at submit time, so the moderation queue can still describe the item after
    // its underlying record has been edited or removed. Never authoritative —
    // the live record is re-read when it still exists.
    snapshot: { type: mongoose.Schema.Types.Mixed, default: {} },

    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    resolutionNote: { type: String, default: '', trim: true, maxlength: 1000 },
  },
  { timestamps: true }
);

// Spam/duplicate guard: one report per user per item. The second attempt is
// rejected with a clear 409 (see reportController.createReport) rather than
// silently creating a row — and a unique index is what makes that race-safe.
reportSchema.index({ reporter: 1, entityType: 1, entityId: 1 }, { unique: true });
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ createdAt: -1 });
reportSchema.index({ entityType: 1, entityId: 1 });

export default mongoose.model('Report', reportSchema);
