import mongoose from 'mongoose';

const semesterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true }, // e.g. "1st Semester"
    code: { type: String, required: true, unique: true, uppercase: true, trim: true }, // e.g. "SEM-1"
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

export default mongoose.model('Semester', semesterSchema);
