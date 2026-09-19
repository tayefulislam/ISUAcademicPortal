import mongoose from 'mongoose';

// An immutable snapshot of an application's text. Append-only: an export is
// always produced from the newest version, never from a rewritten older one.

export const VERSION_SOURCES = ['AI', 'USER', 'FINAL'];

const applicationVersionSchema = new mongoose.Schema(
  {
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true },
    version: { type: Number, required: true },
    source: { type: String, enum: VERSION_SOURCES, default: 'USER' },
    content: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

applicationVersionSchema.index({ application: 1, version: 1 }, { unique: true });

export default mongoose.model('ApplicationVersion', applicationVersionSchema);
