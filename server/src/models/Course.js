import mongoose from 'mongoose';

const courseSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    courseId: { type: String, required: true, unique: true, uppercase: true, trim: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    description: { type: String, default: '' },
    credit: { type: Number, default: 3 },
    semester: { type: String, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

courseSchema.index({ name: 'text', courseId: 'text' });
courseSchema.index({ department: 1 });

export default mongoose.model('Course', courseSchema);
