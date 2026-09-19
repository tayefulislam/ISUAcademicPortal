import mongoose from 'mongoose';

export const DOCUMENT_STATUSES = ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED', 'DELETED'];

// A status the client should keep polling for; every other status is terminal.
export const DOCUMENT_ACTIVE_STATUSES = ['QUEUED', 'PROCESSING'];

// One generation request. No large binary is ever stored here — only the S3
// object key — so the database never carries the document itself.
const documentJobSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    template: { type: mongoose.Schema.Types.ObjectId, ref: 'DocumentTemplate', required: true },
    // Pinned at request time so the document can always be reproduced from the
    // exact design that made it, whatever the template looks like later.
    templateVersion: { type: Number, required: true },
    templateName: { type: String, default: '' },
    category: { type: String, required: true },
    courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
    // The teacher the student chose for this document, pinned so a retry prints
    // the same name. Validated against the course's own faculty when the job was
    // created; never taken on trust from the client.
    facultyId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Only the editable values, sanitized. Official academic values are never
    // accepted from the client — they are resolved server-side (fieldResolver).
    inputData: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Audit snapshot of what was actually printed (resolved values plus the ids
    // they came from), so a generated document can be explained later without
    // re-deriving from records that may since have changed.
    resolved: { type: mongoose.Schema.Types.Mixed, default: {} },

    status: { type: String, enum: DOCUMENT_STATUSES, default: 'QUEUED' },
    queueJobId: { type: String, default: '' },

    // The object key only. A URL is never persisted: a download mints a fresh,
    // short-lived signed URL on demand, after an ownership check.
    s3Key: { type: String, default: '' },
    fileName: { type: String, default: '' },
    sizeBytes: { type: Number, default: 0 },

    attempts: { type: Number, default: 0 },
    // Sanitized, human-readable reason only — never a stack trace.
    error: { type: String, default: '' },

    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

documentJobSchema.index({ user: 1, createdAt: -1 });
// The cleanup sweep: "everything past its expiry that isn't already terminal".
documentJobSchema.index({ status: 1, expiresAt: 1 });

export default mongoose.model('DocumentJob', documentJobSchema);
