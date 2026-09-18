import mongoose from 'mongoose';

// The document categories (Experiment, Lab Report, Assignment, Project,
// Presentation, Other) are data, not code: a Super Admin can add another one
// through the admin UI and it is immediately selectable on a template, with no
// frontend or backend change. That is the whole point of a collection rather
// than an enum — the spec requires new categories without a developer.
const documentCategorySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    // A lucide icon name the clients render beside the category (e.g.
    // "flask-conical"). Optional — an unknown/blank icon falls back to a generic
    // document icon rather than rendering nothing.
    icon: { type: String, default: '' },
    description: { type: String, default: '' },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

documentCategorySchema.index({ isActive: 1, order: 1 });

export default mongoose.model('DocumentCategory', documentCategorySchema);
