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

// 'external' is not a real object store — it marks a material submitted as a
// link (Google Drive, OneDrive, Dropbox, …) rather than an uploaded file, so
// there is nothing to delete from storage for it.
export const STORAGE_PROVIDERS = ['local', 'imgbb', 'uploadcare', 's3', 'external'];

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
    // ImgBB delete token, or S3 object key â€” used for clean deletion. Never exposed to the client.
    storageRef: { type: String, default: '' },
    // Optional link to the universal upload pipeline's metadata record.
    //
    // ADDITIVE and deliberately nullable: every attachment created before the
    // pipeline existed (and every one still created through the legacy
    // storeUploadedFile path) simply has no StoredFile, and nothing reads this
    // unless it is set. This is what lets a material's optimization details —
    // original vs stored size, what was done, thumbnails — be surfaced later
    // without a migration or a change to any existing write path.
    storedFileId: { type: mongoose.Schema.Types.ObjectId, ref: 'StoredFile', default: null },
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

    // 'file' = an uploaded/attached object (the default, unchanged); 'external'
    // = a material submitted as an HTTPS link instead of an upload. An external
    // entry still carries one synthetic attachment descriptor (fileType 'other',
    // storageProvider 'external') so every consumer that assumes attachments[]
    // is non-empty keeps working — there is simply no object to delete.
    uploadType: { type: String, enum: ['file', 'external'], default: 'file' },
    externalUrl: { type: String, default: '' },

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

    // "Material type" in the spec — reuses this existing flat, admin-managed
    // taxonomy rather than introducing a duplicate concept.
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    categoryName: { type: String, required: true },

    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', default: null },
    chapterName: { type: String, default: '' },
    topic: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic', default: null },
    topicName: { type: String, default: '' },

    description: { type: String, default: '' },
    keywords: [{ type: String, trim: true, lowercase: true }],

    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    views: { type: Number, default: 0 },
    downloads: { type: Number, default: 0 },

    status: { type: String, enum: ['active', 'archived'], default: 'active' },

    // 'public' = anyone, no login. 'login_required' = must be signed in.
    // Independent of `restrictions` below — a login_required file with no
    // restrictions is open to any signed-in user.
    visibility: { type: String, enum: ['public', 'login_required'], default: 'login_required' },

    // Optional fine-grained access narrowing. Each non-empty axis is an OR
    // (any listed department/batch/semester/course matches); axes present
    // are ANDed together. All axes empty = no restriction beyond `visibility`.
    restrictions: {
      departments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
      batches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Batch' }],
      // ObjectId refs (not free-text) so they compare directly against the
      // student's own `User.semester` ref when enforcing access.
      semesters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Semester' }],
      courses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
    },

    // Version history: each replace pushes the outgoing attachments/metadata
    // here before swapping in the new ones, mirroring the attachments[]
    // embedding pattern already used above.
    versions: [
      {
        attachments: [attachmentSchema],
        title: String,
        description: String,
        fileSize: Number,
        versionNumber: Number,
        replacedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        replacedAt: { type: Date, default: Date.now },
      },
    ],
    currentVersion: { type: Number, default: 1 },

    // Student submissions start 'pending' and are structurally excluded from
    // every public/browsing query (see buildFileQuery) regardless of
    // `visibility`/`restrictions` until a reviewer approves them. There is no
    // persisted 'rejected' state — rejection means immediate deletion of both
    // the document and its storage objects.
    approvalStatus: { type: String, enum: ['approved', 'pending'], default: 'approved' },
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
fileSchema.index({ chapter: 1 });
fileSchema.index({ topic: 1 });
fileSchema.index({ visibility: 1 });
fileSchema.index({ 'restrictions.departments': 1 });
fileSchema.index({ 'restrictions.batches': 1 });
fileSchema.index({ approvalStatus: 1 });
fileSchema.index({ uploadType: 1 });

export default mongoose.model('File', fileSchema);
