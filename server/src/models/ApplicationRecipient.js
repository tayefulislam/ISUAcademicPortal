import mongoose from 'mongoose';

// An official recipient an application may be addressed to — the Registrar, a
// Head of Department, a Dean, an office. Admin-managed data, never authored by
// the AI: the whole point is that the letter's "To" block is the university's
// own record, not something a model invented.
//
// A HOD recipient may be scoped to one department (`department`), and the
// department's own `head` (models/Department.js) takes precedence for it — see
// services/applications/recipientResolver.js.

export const RECIPIENT_TYPES = [
  'REGISTRAR',
  'HOD',
  'DEAN',
  'FACULTY',
  'FINANCE',
  'EXAM',
  'ADMIN',
  'OTHER',
];

const letterheadSchema = new mongoose.Schema(
  {
    universityName: { type: String, default: '', trim: true },
    addressLine: { type: String, default: '', trim: true },
    footer: { type: String, default: '', trim: true },
  },
  { _id: false }
);

const applicationRecipientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    designation: { type: String, default: '', trim: true },
    office: { type: String, default: '', trim: true },
    address: { type: String, default: '', trim: true },
    type: { type: String, enum: RECIPIENT_TYPES, default: 'OTHER' },
    // For a HOD recipient: which department it belongs to. Null = the single
    // university-wide record for that type (e.g. the Registrar).
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    letterhead: { type: letterheadSchema, default: () => ({}) },
  },
  { timestamps: true }
);

// The picker asks for one active list sorted by order; the resolver looks one up
// by type + department.
applicationRecipientSchema.index({ active: 1, order: 1 });
applicationRecipientSchema.index({ type: 1, department: 1, active: 1 });

export default mongoose.model('ApplicationRecipient', applicationRecipientSchema);
