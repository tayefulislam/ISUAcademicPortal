import mongoose from 'mongoose';

// One draft/application. The applicant's official details are never stored as
// editable input — they are captured as an immutable snapshot at generation
// time (from the authenticated user's own record) so a finalised letter always
// reproduces exactly what it printed, exactly like a generated document pins its
// template version.

export const APPLICATION_STATUSES = [
  'DRAFT',
  'GENERATED',
  'EDITED',
  'EXPORTED',
  'SUBMITTED',
  'ARCHIVED',
];

const recipientSnapshotSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'ApplicationRecipient', default: null },
    name: { type: String, default: '' },
    designation: { type: String, default: '' },
    office: { type: String, default: '' },
    address: { type: String, default: '' },
    type: { type: String, default: '' },
    letterhead: {
      universityName: { type: String, default: '' },
      addressLine: { type: String, default: '' },
      footer: { type: String, default: '' },
    },
  },
  { _id: false }
);

const applicationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // The ApplicationType.key (a stable slug, so renaming the type is an edit).
    applicationType: { type: String, required: true, trim: true },
    // The human name at the time of the application (denormalised so a renamed
    // type does not rewrite history).
    applicationTypeName: { type: String, default: '' },

    recipient: { type: recipientSnapshotSchema, default: () => ({}) },
    subject: { type: String, default: '', trim: true },
    details: { type: String, default: '' },
    additionalInfo: { type: String, default: '' },
    // The answers to the type's dynamic questions, by field key.
    structuredData: { type: Map, of: String, default: () => new Map() },

    status: { type: String, enum: APPLICATION_STATUSES, default: 'DRAFT' },
    currentVersion: { type: Number, default: 0 },

    // The AI's draft and the user's living copy, kept apart so "reset to the
    // AI version" is always possible and the AI's output is never lost.
    aiContent: { type: String, default: '' },
    editedContent: { type: String, default: '' },
    suggestions: { type: [String], default: [] },

    // The verified profile as it was when this application was generated.
    profileSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

applicationSchema.index({ user: 1, createdAt: -1 });
applicationSchema.index({ user: 1, status: 1 });

export default mongoose.model('Application', applicationSchema);
