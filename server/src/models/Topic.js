import mongoose from 'mongoose';

const topicSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', required: true },
    // Denormalized from chapter.course — lets us list/filter topics by
    // course directly without an extra populate/join.
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    order: { type: Number, default: 0 },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

topicSchema.index({ chapter: 1, name: 1 }, { unique: true });
topicSchema.index({ course: 1 });

export default mongoose.model('Topic', topicSchema);
