import StoredFile from '../../../models/StoredFile.js';
import { createStoredFile } from '../metadata/storedFileService.js';
import { categoryForExtension, categoryForMime } from '../detection/categories.js';
import { logger } from '../../../utils/logger.js';

/**
 * The bridge between the universal upload pipeline and the existing academic
 * material model.
 *
 * WHY THIS IS SEPARATE FROM `storeUploadedFile`:
 *
 * The legacy material flow calls `storeUploadedFile(buffer, name, mime)` and
 * needs a `fileUrl` back SYNCHRONOUSLY, inside the request, to write into the
 * File document. The new pipeline is deliberately asynchronous — it returns an
 * id and processes in a worker. Rewiring the legacy call to queue would mean a
 * material's `fileUrl` no longer exists when its File row is saved, which would
 * break every existing upload, viewer and download. So the legacy path is left
 * exactly as it is, and this module is the seam between the two worlds:
 *
 *   - an existing (already-stored) attachment can be RECORDED as a StoredFile,
 *     which is how existing material is brought into the dashboard's numbers
 *     without moving a single byte (§28.5, "migration compatibility");
 *   - an upload that DID go through the pipeline can be attached to a material
 *     with its `storedFileId` set, so the material gains optimization metadata
 *     and a thumbnail without changing its own schema.
 *
 * Nothing here is on a hot path, and nothing here is required for the legacy
 * flow to keep working.
 */

/** The category a material attachment belongs to, from its own mime/extension. */
function categoryFor(mimeType, originalName) {
  const ext = String(originalName || '').split('.').pop()?.toLowerCase() || '';
  return categoryForMime(mimeType) || categoryForExtension(ext) || 'other';
}

/**
 * Records a StoredFile for an attachment that was stored by the LEGACY path.
 *
 * Used for the backfill (so pre-existing material appears in the storage
 * dashboard and duplicate detection) and by any future opt-in path that still
 * stores eagerly. The sizes are set equal — nothing was optimized — which is the
 * truthful description of a legacy upload.
 *
 * @param {{storageProvider:string, storageRef:string, mimeType:string, originalName:string, fileSize:number, fileUrl?:string}} attachment
 * @param {{ownerId:string, purpose?:string, createdAt?:Date}} options
 */
export async function recordStoredFileForAttachment(attachment, { ownerId, purpose = 'academic-material' } = {}) {
  if (!attachment?.storageRef) return null;

  try {
    const record = await createStoredFile({
      ownerId,
      originalName: attachment.originalName,
      storedName: String(attachment.storageRef).split('/').pop() || '',
      extension: String(attachment.originalName || '').split('.').pop()?.toLowerCase() || '',
      mimeType: attachment.mimeType,
      detectedMimeType: attachment.mimeType,
      category: categoryFor(attachment.mimeType, attachment.originalName),
      originalSize: Number(attachment.fileSize) || 0,
      storageProvider: attachment.storageProvider,
      storageKey: attachment.storageRef,
      storageRef: attachment.storageRef,
      // A legacy attachment is already final — it is not waiting on anything.
      processingStatus: 'COMPLETED',
      uploadMode: 'direct',
      purpose,
    });

    if (attachment.fileUrl) {
      await StoredFile.updateOne({ _id: record._id }, { $set: { storedOriginal: true, storedSize: Number(attachment.fileSize) || 0 } });
    }
    return record;
  } catch (err) {
    // A backfill that cannot record one attachment must not abort the rest.
    logger.warn(`[uploads] could not record a StoredFile for ${attachment.originalName}: ${err.message}`, {
      source: 'materialBridge',
    });
    return null;
  }
}

/**
 * Builds a `File.attachments[]` entry from a pipeline StoredFile, carrying the
 * `storedFileId` link.
 *
 * @param {object} stored a StoredFile document
 * @param {{fileUrl:string, fileType:string}} derived the URL/fileType the material model expects
 */
export function attachmentFromStoredFile(stored, { fileUrl, fileType }) {
  return {
    originalName: stored.originalName,
    fileName: stored.storedName || stored.originalName,
    fileType,
    mimeType: stored.detectedMimeType || stored.mimeType,
    fileSize: stored.storedSize || stored.originalSize,
    fileUrl,
    storageProvider: stored.storageProvider,
    storageRef: stored.storageRef || stored.storageKey,
    storedFileId: stored._id,
  };
}

/**
 * Points a material document's first attachment at a StoredFile.
 *
 * Idempotent and additive — it only ever adds a link, never alters the
 * attachment's own stored location, so a material that is already reachable
 * stays exactly as reachable as it was.
 */
export async function linkStoredFileToMaterial(materialDoc, storedFileId) {
  if (!materialDoc?.attachments?.length) return materialDoc;
  materialDoc.attachments[0].storedFileId = storedFileId;
  materialDoc.markModified('attachments');
  await materialDoc.save();
  return materialDoc;
}

export default { recordStoredFileForAttachment, attachmentFromStoredFile, linkStoredFileToMaterial };
