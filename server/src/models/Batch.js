import mongoose from 'mongoose';

const batchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // e.g. BATCH-14
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    year: { type: Number, default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

batchSchema.index({ name: 'text', code: 'text' });

export default mongoose.model('Batch', batchSchema);
