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

export const STORAGE_PROVIDERS = ['local', 'imgbb', 'uploadcare', 's3'];

// One physical file within a File entry. A single upload with a shared
// title can bundle several of these (e.g. a lecture note PDF plus its
// diagram images) under one searchable, one-titled record.
const attachmentSchema = new mongoose.Schema(
  {
    originalName: { type: String, required: true },
    fileName: { type: String, required: true }, // safe generated name on disk (local provider only)
    fileType: { type: String, enum: FILE_TYPES, required: true },
    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true }, // bytes
    fileUrl: { type: String, required: true },
    storageProvider: { type: String, enum: STORAGE_PROVIDERS, required: true },
    // ImgBB delete token, or S3 object key — used for clean deletion. Never exposed to the client.
    storageRef: { type: String, default: '' },
  },
  { _id: true }
);

const fileSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },

    // Mirror of attachments[0] — kept at the top level so single-attachment
    // entries (the common case) work with existing card/viewer/filter code
    // without reaching into the attachments array.
    originalName: { type: String, required: true },
    fileName: { type: String, required: true },
    fileType: { type: String, enum: FILE_TYPES, required: true },
    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true }, // bytes, summed across all attachments
    fileUrl: { type: String, required: true },
    storageProvider: { type: String, enum: STORAGE_PROVIDERS, required: true },
    storageRef: { type: String, default: '' },

    attachments: {
      type: [attachmentSchema],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'At least one attachment is required',
      },
    },
    fileCount: { type: Number, default: 1 },

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
