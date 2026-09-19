import mongoose from 'mongoose';

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    // The official head of the department — a User (usually a faculty member).
    // Used by the Write Application module: when an applicant addresses "Head of
    // Department", this is who/what the document is addressed to, so the AI is
    // never asked to invent a HOD. Nullable, and optional per department.
    head: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

departmentSchema.index({ name: 'text', code: 'text' });

export default mongoose.model('Department', departmentSchema);
