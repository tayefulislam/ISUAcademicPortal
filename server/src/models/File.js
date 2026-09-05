import mongoose from 'mongoose';

export const FILE_TYPES = [
  'pdf',
  'image',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'txt',
  'zip',
  'other',
];

const fileSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    originalName: { type: String, required: true },
    fileName: { type: String, required: true }, // safe generated name on disk (local provider only)

    fileType: { type: String, enum: FILE_TYPES, required: true },
    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true }, // bytes

    fileUrl: { type: String, required: true },
    storageProvider: { type: String, enum: ['local', 'imgbb', 's3'], required: true },
    // ImgBB delete token, or S3 object key — used for clean deletion. Never exposed to the client.
    storageRef: { type: String, default: '' },

    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    departmentCode: { type: String, required: true, uppercase: true },

    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    courseName: { type: String, required: true },
    courseId: { type: String, required: true, uppercase: true },

    batches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Batch' }],
    batchCodes: [{ type: String, uppercase: true }], // denormalized for search; empty array = all batches
    allBatches: { type: Boolean, default: false },

    semester: { type: String, default: '' },
    academicYear: { type: String, default: '' },

    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    categoryName: { type: String, required: true },

    description: { type: String, default: '' },
    keywords: [{ type: String, trim: true, lowercase: true }],

    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    views: { type: Number, default: 0 },
    downloads: { type: Number, default: 0 },

    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true }
);

fileSchema.index(
  {
    title: 'text',
    originalName: 'text',
    courseName: 'text',
    courseId: 'text',
    departmentCode: 'text',
    categoryName: 'text',
    keywords: 'text',
  },
  {
    weights: {
      title: 10,
      courseName: 8,
      courseId: 8,
      keywords: 6,
      departmentCode: 4,
      categoryName: 3,
      originalName: 2,
    },
    name: 'FileSearchIndex',
  }
);

fileSchema.index({ department: 1 });
fileSchema.index({ course: 1 });
fileSchema.index({ batches: 1 });
fileSchema.index({ batchCodes: 1 });
fileSchema.index({ category: 1 });
fileSchema.index({ fileType: 1 });
fileSchema.index({ createdAt: -1 });
fileSchema.index({ views: -1 });
fileSchema.index({ downloads: -1 });

export default mongoose.model('File', fileSchema);
