import mongoose from 'mongoose';

const chapterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    order: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

chapterSchema.index({ course: 1, name: 1 }, { unique: true });

export default mongoose.model('Chapter', chapterSchema);
