import StoredFile from '../../../models/StoredFile.js';
import File from '../../../models/File.js';
import { createStoredFile, failProcessing } from '../metadata/storedFileService.js';
import { categoryForExtension, categoryForMime } from '../detection/categories.js';
import { mustStoreOriginal } from '../document/archiveGuard.js';
import { enqueueFileProcessing } from '../../queue/fileProcessingQueue.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

/**
 * The bridge between the universal upload pipeline and the academic material
 * model — this is what makes a material uploaded through Upload Material /
 * Submit Material get optimized and stored smaller.
 *
 * HOW A MATERIAL GETS OPTIMIZED
 *
 * Those screens store the file the way they always have — synchronously, in the
 * request — and then call {@link queueMaterialOptimization}. That ordering is the
 * whole design:
 *
 *   1. the material is saved pointing at the ORIGINAL object, so it is complete,
 *      valid and downloadable the moment the request returns;
 *   2. a StoredFile is recorded for that object, carrying the File id and the
 *      exact attachment id it belongs to;
 *   3. the worker optimizes off the request path and, once a smaller VALIDATED
 *      object is in storage, {@link applyOptimizedMaterialAttachment} repoints
 *      that attachment at it;
 *   4. only then is the original object deleted.
 *
 * So the API never blocks on a 98 MB PDF, and the material never references an
 * object that does not exist. If any step fails the material is simply still
 * pointing at the original — "not optimized" is the worst outcome, never "gone".
 *
 * The same module also backs the migration path
 * ({@link recordStoredFileForAttachment}) that brings pre-existing material into
 * the dashboard's numbers without moving a byte (§28.5).
 */

/** The category a material attachment belongs to, from its own mime/extension. */
function categoryFor(mimeType, originalName) {
  const ext = String(originalName || '').split('.').pop()?.toLowerCase() || '';
  return categoryForMime(mimeType) || categoryForExtension(ext) || 'other';
}

function extensionOf(name) {
  return String(name || '').split('.').pop()?.toLowerCase() || '';
}

function baseNameOf(key) {
  return String(key || '').split('/').pop() || '';
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

/**
 * Records an optimization job for a material's freshly-stored attachments.
 *
 * <p>Called AFTER the File document exists, because the worker needs both the
 * File's id and the exact attachment's id to repoint the record at the smaller
 * object. The material is already complete and usable at this point — it points
 * at the original — which is precisely what makes doing this afterwards safe.
 *
 * <p>Nothing here may fail the upload. The queue being unreachable must leave the
 * file stored and usable exactly as uploaded, which is the state every material
 * was in before this existed.
 *
 * @param {object} file a saved File document
 * @param {{ownerId?:string}} [options] defaults to the File's own uploader
 * @returns {Promise<{queued:number, recorded:number, skipped:number}>}
 */
export async function queueMaterialOptimization(file, { ownerId } = {}) {
  if (!env.uploads.enabled || !file?._id) {
    return { queued: 0, recorded: 0, skipped: 0 };
  }

  const recorded = [];
  let skipped = 0;
  let dirty = false;

  for (const attachment of file.attachments || []) {
    // An external-link material has no stored object — there are no bytes to
    // optimize.
    if (!attachment.storageRef || attachment.storageProvider === 'external') {
      skipped += 1;
      continue;
    }
    // Already linked — a re-queue after a partial failure must not create a
    // second record for the same object.
    if (attachment.storedFileId) {
      skipped += 1;
      continue;
    }

    const ext = extensionOf(attachment.originalName);

    try {
      const record = await createStoredFile({
        ownerId: ownerId || file.uploadedBy,
        originalName: attachment.originalName,
        storedName: baseNameOf(attachment.storageRef),
        extension: ext,
        mimeType: attachment.mimeType,
        detectedMimeType: attachment.mimeType,
        category: categoryFor(attachment.mimeType, attachment.originalName),
        originalSize: Number(attachment.fileSize) || 0,
        storageProvider: attachment.storageProvider,
        storageKey: attachment.storageRef,
        storageRef: attachment.storageRef,
        processingStatus: 'QUEUED',
        purpose: 'academic-material',
        source: { kind: 'material', fileId: file._id, attachmentId: attachment._id },
      });

      // Linked immediately, so the material knows its own record even if the
      // queue never runs and the dashboard accounts for the bytes either way.
      attachment.storedFileId = record._id;
      dirty = true;

      // A format the decision engine would refuse to touch anyway is recorded as
      // already-final instead of queued. This is the SAME predicate the engine
      // uses, so they cannot disagree — and it is what stops a 1 GB video from
      // being downloaded by a worker just to be told "store it as it is".
      if (mustStoreOriginal(ext)) {
        await StoredFile.updateOne(
          { _id: record._id },
          { $set: { processingStatus: 'COMPLETED', processingMethod: 'none', storedOriginal: true } }
        );
        skipped += 1;
        continue;
      }

      recorded.push(record._id);
    } catch (err) {
      logger.warn(`[uploads] could not record an optimization job for ${attachment.originalName}: ${err.message}`, {
        source: 'materialBridge.queue',
      });
      skipped += 1;
    }
  }

  if (dirty) {
    file.markModified('attachments');
    await file.save();
  }

  // Enqueued only after the links are saved: a job that ran before the link
  // existed would have nothing to repoint.
  let queued = 0;
  for (const id of recorded) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await enqueueFileProcessing(id);
      queued += 1;
    } catch (err) {
      logger.error(err, { source: 'materialBridge.enqueue', meta: { fileId: String(file._id) } });
      // The material keeps working (it points at the original); the record is
      // marked so the storage dashboard is honest about it, and
      // POST /api/uploads/:id/retry can pick it up.
      // eslint-disable-next-line no-await-in-loop
      await failProcessing(id, {
        code: 'QUEUE_UNAVAILABLE',
        message: 'Optimization could not be scheduled; the file was stored as uploaded',
      }).catch(() => null);
    }
  }

  return { queued, recorded: recorded.length, skipped };
}

/**
 * Repoints a material's attachment at the optimized object.
 *
 * <p>Runs only once a smaller, VALIDATED object is already in storage, and the
 * caller deletes the original only after this resolves. If it fails, nothing is
 * lost: the material still points at a working object.
 *
 * @returns {Promise<boolean>} true when the attachment now points at `storageKey`
 */
export async function applyOptimizedMaterialAttachment({
  fileId,
  attachmentId,
  storageKey,
  fileUrl,
  storedSize,
  storedFileId,
}) {
  if (!fileId || !attachmentId || !storageKey) return false;

  const file = await File.findById(fileId);
  if (!file) return false;

  const index = file.attachments.findIndex((a) => String(a._id) === String(attachmentId));
  if (index < 0) return false;

  const attachment = file.attachments[index];
  // A retry of an already-applied optimization: nothing to do, and reporting
  // success is correct — the attachment already points at this object.
  if (attachment.storageRef === storageKey) return true;

  attachment.storageRef = storageKey;
  attachment.fileUrl = fileUrl;
  attachment.fileSize = Number(storedSize) || attachment.fileSize;
  attachment.fileName = baseNameOf(storageKey) || attachment.fileName;
  if (storedFileId) attachment.storedFileId = storedFileId;

  // attachments[0] is mirrored on the document itself, and the top-level
  // fileSize is the SUM across attachments (see models/File.js) — so both have
  // to follow, or listings would keep advertising the old object and the old
  // total.
  if (index === 0) {
    file.fileUrl = fileUrl;
    file.storageRef = storageKey;
    file.fileName = attachment.fileName;
  }
  file.fileSize = file.attachments.reduce((sum, a) => sum + (Number(a.fileSize) || 0), 0);

  file.markModified('attachments');
  await file.save();
  return true;
}

export default {
  recordStoredFileForAttachment,
  attachmentFromStoredFile,
  linkStoredFileToMaterial,
  queueMaterialOptimization,
  applyOptimizedMaterialAttachment,
};
