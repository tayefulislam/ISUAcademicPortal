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
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

applicationExportSchema.index({ user: 1, createdAt: -1 });
// The cleanup sweep's exact query.
applicationExportSchema.index({ status: 1, expiresAt: 1 });

export default mongoose.model('ApplicationExport', applicationExportSchema);
