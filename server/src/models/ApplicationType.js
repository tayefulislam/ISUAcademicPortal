import mongoose from 'mongoose';

// A kind of application ("Tuition Fee Reduction", "Leave Application", …).
//
// DB-driven, exactly like DocumentCategory: an administrator adds a type, its
// dynamic questions and its document wording through the admin UI, and it is
// available immediately — no code change. Nothing in the client enumerates the
// values.

/** One extra structured question a type asks (see spec §16). */
const fieldSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    // TEXT | TEXTAREA | NUMBER | DATE | SELECT | BOOLEAN
    type: { type: String, default: 'TEXT' },
    required: { type: Boolean, default: false },
    placeholder: { type: String, default: '' },
    // For SELECT.
    options: { type: [String], default: [] },
  },
  { _id: false }
);

const templateSchema = new mongoose.Schema(
  {
    // The line after the recipient block, e.g. "Dear Sir/Madam,".
    salutation: { type: String, default: 'Dear Sir/Madam,', trim: true },
    // The paragraph before the signature block.
    closing: {
      type: String,
      default: 'I shall be grateful for your kind consideration.',
      trim: true,
    },
    // Optional overrides for the document letterhead; empty falls back to the
    // recipient's, then to the university name configured on the server.
    headerOverride: { type: String, default: '', trim: true },
    footerOverride: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const applicationTypeSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    // Standing guidance handed to the AI for this type, and shown to the user.
    defaultInstructions: { type: String, default: '', trim: true },
    fields: { type: [fieldSchema], default: [] },
    template: { type: templateSchema, default: () => ({}) },
  },
  { timestamps: true }
);

applicationTypeSchema.index({ active: 1, order: 1 });

export default mongoose.model('ApplicationType', applicationTypeSchema);
