import mongoose from 'mongoose';

// A generated PDF/DOCX file. The file itself is a TEMPORARY artefact — it is
// deleted from object storage when it expires (24h by default). The Application
// it was made from is untouched by that, which is the whole point of keeping the
// two lifetimes separate.
//
// Only the storage key is stored, never a URL: a link is minted fresh on each
// authorized download and is never permanent.

export const EXPORT_FILE_TYPES = ['PDF', 'DOCX'];
export const EXPORT_STATUSES = ['ACTIVE', 'EXPIRED', 'DELETED'];

const applicationExportSchema = new mongoose.Schema(
  {
    application: { type: mongoose.Schema.Types.ObjectId, ref: 'Application', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    fileType: { type: String, enum: EXPORT_FILE_TYPES, required: true },
    storageRef: { type: String, default: '' },
    provider: { type: String, default: '' },
    fileName: { type: String, default: '' },
    sizeBytes: { type: Number, default: 0 },
    status: { type: String, enum: EXPORT_STATUSES, default: 'ACTIVE' },
    expiresAt: { type: Date, default: null },
    // When the file stopped being downloadable, and when its object was
    // actually removed from storage. They are deliberately separate: a request
    // for the link after expiry marks the row unavailable WITHOUT deleting
    // anything (it must not block on object storage), so the sweep keys off
    // storageDeletedAt rather than status to make sure those bytes are still
    // removed instead of being orphaned forever.
    deletedAt: { type: Date, default: null },
    storageDeletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

applicationExportSchema.index({ user: 1, createdAt: -1 });
// The cleanup sweep's exact query: expired, still claiming an object, and not
// yet confirmed deleted.
applicationExportSchema.index({ expiresAt: 1, storageDeletedAt: 1 });

export default mongoose.model('ApplicationExport', applicationExportSchema);
