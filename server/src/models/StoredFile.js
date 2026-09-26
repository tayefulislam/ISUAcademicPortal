import mongoose from 'mongoose';

/**
 * The generic metadata record for the universal upload pipeline.
 *
 * This is deliberately NOT the academic-material `File` model. A `StoredFile` is
 * "a blob we hold, what it is, how big it was, how big it ended up, and who may
 * read it" — the concern the spec is about. `File` keeps its own meaning
 * (a searchable material with a department/course/category) and links here
 * through an optional `attachments[].storedFileId`, so existing flows are
 * untouched while new uploads gain the pipeline.
 *
 * The binary NEVER lives here — only its object key. A URL is never stored
 * either: a download mints a fresh, short-lived one on demand (see
 * storageService.getObjectDownloadUrl), so a database dump can never leak a
 * working link.
 */

// Every state a job can be in. The client polls until it reaches a terminal
// one (COMPLETED / FAILED / CANCELLED).
export const STORED_FILE_STATUSES = [
  'QUEUED',
  'UPLOADING',
  'PROCESSING',
  'VALIDATING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

// A status worth continuing to poll; every other status is terminal.
export const STORED_FILE_ACTIVE_STATUSES = ['QUEUED', 'UPLOADING', 'PROCESSING', 'VALIDATING'];

export const STORED_FILE_VISIBILITIES = ['private', 'course', 'department', 'batch', 'public', 'role'];

// How the stored bytes relate to what was uploaded. `none` is a first-class,
// common outcome — it means the original was already optimal.
export const PROCESSING_METHODS = [
  'none',
  'image-optimize',
  'pdf-image-optimization',
  'text-compression',
  'deduplicated',
];

export const UPLOAD_MODES = ['direct', 'multipart'];

// One generated derivative (thumbnail/preview). A derivative is a separate
// object with its own key, so the Android client can fetch a small image first.
const derivativeSchema = new mongoose.Schema(
  {
    key: { type: String, default: '' },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    sizeBytes: { type: Number, default: 0 },
    mimeType: { type: String, default: '' },
  },
  { _id: false }
);

// Multipart bookkeeping. `parts` accumulates as the client reports completed
// parts, so an interrupted upload can be resumed by asking which parts are
// already in and re-sending only the rest.
const multipartSchema = new mongoose.Schema(
  {
    uploadId: { type: String, default: '' },
    partSizeBytes: { type: Number, default: 0 },
    totalParts: { type: Number, default: 0 },
    parts: [
      {
        _id: false,
        partNumber: { type: Number, required: true },
        etag: { type: String, default: '' },
      },
    ],
    initiatedAt: { type: Date, default: null },
  },
  { _id: false }
);

const storedFileSchema = new mongoose.Schema(
  {
    // The owner. Both names from the spec's schema collapse to this one field —
    // the rest of the app already calls an uploader `uploadedBy`, so this is it.
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // What the user called it, and what it is. `originalName` is never used to
    // build a storage key or a filesystem path (see security/filenameSanitizer).
    originalName: { type: String, required: true },
    storedName: { type: String, default: '' },
    extension: { type: String, default: '', lowercase: true },

    // `mimeType` is what the client claimed; `detectedMimeType` is what the
    // magic bytes proved. They are kept apart on purpose — where they disagree
    // is exactly the signal that someone renamed a file to bypass a check.
    mimeType: { type: String, default: 'application/octet-stream' },
    detectedMimeType: { type: String, default: '' },
    detectedLabel: { type: String, default: '' },
    category: { type: String, default: 'other', index: true },
    typeMismatch: { type: Boolean, default: false },

    // Original vs stored, and the arithmetic between them (§11).
    originalSize: { type: Number, default: 0, min: 0 },
    storedSize: { type: Number, default: 0, min: 0 },
    savedBytes: { type: Number, default: 0 },
    savedPercentage: { type: Number, default: 0 },

    // Where the bytes live. `storageKey` is the object key; `storageRef` mirrors
    // it for parity with the rest of the app's storage calls.
    storageProvider: { type: String, default: 'local' },
    bucket: { type: String, default: '' },
    storageKey: { type: String, default: '' },
    storageRef: { type: String, default: '' },

    // Processing state.
    processingStatus: { type: String, enum: STORED_FILE_STATUSES, default: 'QUEUED', index: true },
    processingMethod: { type: String, enum: PROCESSING_METHODS, default: 'none' },
    qualityProfile: { type: String, default: '' },
    compression: { type: String, default: '' },
    // True when the stored object is still byte-identical to the upload.
    storedOriginal: { type: Boolean, default: true },

    checksum: { type: String, default: '', index: true },
    etag: { type: String, default: '' },

    // Cheap structural facts, filled in during analysis.
    pageCount: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },

    // Access policy (§18). `private` is the safe default: a file is never
    // readable by another user merely because they know its id.
    visibility: { type: String, enum: STORED_FILE_VISIBILITIES, default: 'private' },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', default: null },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    batches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Batch' }],
    allowedRoles: [{ type: String }],

    // The user-facing purpose/collection this upload belongs to, e.g.
    // 'academic-material' when the pipeline is used behind the material upload
    // flow. Lets the dashboard group, and lets a caller query "my uploads".
    purpose: { type: String, default: 'general' },

    // Where this file came from, when something other than the upload screen owns
    // it. A material upload (Submit Material / Upload Material) records the exact
    // File and attachment, so the worker can repoint THAT attachment at the
    // optimized object once one exists — see metadata/recordBridge.js.
    //
    // Every domain that accepts a file records its provenance here, so the
    // worker knows which record/field to repoint after optimizing:
    //   material          -> File.attachments[<attachmentId>]
    //   assignment        -> Assignment.attachments[<attachmentId>]
    //   submission        -> Submission.attachments[<attachmentId>]
    //   notice            -> Notice.<field> (field names the URL/key fields)
    //   question          -> Question.imageUrl / imageStorageRef
    //   student-id        -> User.studentIdImage
    //   document-template -> DocumentTemplateVersion.sourceFile
    //   document-asset    -> the filesystem asset record
    //   standalone        -> the upload screen's own file, which nothing else references
    source: {
      kind: {
        type: String,
        enum: [
          'standalone',
          'material',
          'assignment',
          'submission',
          'notice',
          'question',
          'student-id',
          'document-template',
          'document-asset',
        ],
        default: 'standalone',
      },
      // The academic-material File, kept as its own typed ref for clarity.
      fileId: { type: mongoose.Schema.Types.ObjectId, ref: 'File', default: null },
      // The owning record for every other kind (Assignment/Submission/Notice/
      // Question/User/DocumentTemplateVersion). Deliberately untyped, since a
      // single field cannot ref several collections.
      recordId: { type: mongoose.Schema.Types.ObjectId, default: null },
      // The exact attachment subdocument for the array-shaped domains.
      attachmentId: { type: mongoose.Schema.Types.ObjectId, default: null },
      // For single-valued domains (notice attachment, question image), the
      // logical field this upload fills, so the apply step can be declarative.
      field: { type: String, default: '' },
    },

    uploadMode: { type: String, enum: UPLOAD_MODES, default: 'direct' },
    multipart: { type: multipartSchema, default: () => ({}) },

    // Generated derivatives (thumbnail/preview) for image-like files.
    derivatives: {
      thumbnail: { type: derivativeSchema, default: () => ({}) },
      preview: { type: derivativeSchema, default: () => ({}) },
    },

    // Where the working copy sits while the job runs, so an abandoned job can be
    // swept. Cleared as soon as the object is safely in storage.
    tempPath: { type: String, default: '' },

    // Failure bookkeeping (§26). The original is always still retrievable after
    // a failed optimization — FAILED means "optimization failed", never "your
    // file is gone".
    errorCode: { type: String, default: '' },
    errorMessage: { type: String, default: '' },
    retryCount: { type: Number, default: 0 },
    lastAttemptAt: { type: Date, default: null },
    queueJobId: { type: String, default: '' },

    // Set only in 'dedupe' mode: the record whose object this one shares.
    dedupeOf: { type: mongoose.Schema.Types.ObjectId, ref: 'StoredFile', default: null },
  },
  { timestamps: true }
);

// "my uploads", newest first — the primary listing path.
storedFileSchema.index({ ownerId: 1, createdAt: -1 });
// Duplicate detection lookup.
storedFileSchema.index({ checksum: 1, ownerId: 1 });
// The cleanup sweep: "still-active jobs that have gone quiet".
storedFileSchema.index({ processingStatus: 1, updatedAt: 1 });
// Dashboard grouping, and key lookups.
storedFileSchema.index({ category: 1, createdAt: -1 });
storedFileSchema.index({ storageKey: 1 });
storedFileSchema.index({ course: 1 });

export default mongoose.model('StoredFile', storedFileSchema);
