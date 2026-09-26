import StoredFile from '../../../models/StoredFile.js';
import Assignment from '../../../models/Assignment.js';
import Submission from '../../../models/Submission.js';
import Notice from '../../../models/Notice.js';
import Question from '../../../models/Question.js';
import User from '../../../models/User.js';
import DocumentTemplateVersion from '../../../models/DocumentTemplateVersion.js';

import { createStoredFile, failProcessing } from './storedFileService.js';
import { applyOptimizedMaterialAttachment } from './materialBridge.js';
import { categoryForExtension, categoryForMime } from '../detection/categories.js';
import { mustStoreOriginal } from '../document/archiveGuard.js';
import { enqueueFileProcessing } from '../../queue/fileProcessingQueue.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

/**
 * The generic bridge between the universal upload pipeline and every domain that
 * accepts a file.
 *
 * `materialBridge` was the first (and, for a while, only) instance of this idea:
 * a domain stores its file the way it always has, then records a StoredFile that
 * carries the provenance — which record, which field — so the worker can
 * optimize off the request path and repoint the record at the smaller object.
 *
 * This module generalizes that pattern to every other file-bearing domain
 * (assignments, submissions, notices, questions, student-ID photos and
 * document-template sources), so none of them is left storing the raw upload
 * forever. `materialBridge.queueMaterialOptimization` remains the material
 * entry point and delegates here.
 *
 * The ordering is the whole design, and it never changes:
 *
 *   1. the domain record is saved pointing at the ORIGINAL object, so it is
 *      complete and usable the moment the request returns;
 *   2. a StoredFile is recorded for that object with its provenance;
 *   3. the worker optimizes and, only once a smaller VALIDATED object is in
 *      storage, {@link applyOptimizedRecord} repoints the record;
 *   4. only then is the original deleted.
 *
 * Nothing here may fail the upload: a queue that is unreachable leaves the file
 * stored and usable exactly as uploaded — "not optimized" is the worst outcome,
 * never "gone".
 */

/** Providers whose objects the pipeline can pull back and rewrite. */
const OPTIMIZABLE_PROVIDERS = new Set(['s3', 'local']);

/** The category an attachment belongs to, from its own mime/extension. */
function categoryFor(mimeType, originalName) {
  const ext = String(originalName || '').split('.').pop()?.toLowerCase() || '';
  return categoryForMime(mimeType) || categoryForExtension(ext) || 'other';
}

function baseNameOf(key) {
  return String(key || '').split('/').pop() || '';
}

/** True when an attachment descriptor is something the pipeline can act on. */
function isOptimizable(item) {
  if (!item?.storageRef) return false;
  if (item.storageProvider && !OPTIMIZABLE_PROVIDERS.has(item.storageProvider)) return false;
  // A format the decision engine would refuse to touch anyway is recorded as
  // already-final instead of queued — the exact predicate the engine uses.
  const ext = String(item.originalName || '').split('.').pop()?.toLowerCase() || '';
  return !mustStoreOriginal(ext);
}

/**
 * Records an optimization job for one or more freshly-stored attachments.
 *
 * @param {object} options
 * @param {string} options.ownerId         the uploader
 * @param {string} options.kind            StoredFile.source.kind
 * @param {string} options.recordId        the owning record's id
 * @param {string} [options.purpose]       grouping label, defaults to `kind`
 * @param {Array<{attachmentId?:string, field?:string, storageProvider?:string,
 *   storageRef:string, mimeType?:string, originalName:string, fileSize?:number}>} options.items
 *   the stored attachments to consider. `field` names the logical slot for the
 *   single-valued domains (e.g. 'attachment', 'image', 'studentIdImage',
 *   'sourceFile').
 * @returns {Promise<{queued:number, recorded:number, skipped:number}>}
 */
export async function recordDomainOptimization({ ownerId, kind, recordId, purpose, items = [] }) {
  if (!env.uploads.enabled || !recordId) {
    return { queued: 0, recorded: 0, skipped: 0 };
  }

  const recorded = [];
  let skipped = 0;

  for (const item of items) {
    if (!item?.storageRef) {
      skipped += 1;
      continue;
    }
    // Nothing to gain from a provider we cannot pull the object back from
    // (ImgBB/Uploadcare serve already-optimized bytes anyway).
    if (item.storageProvider && !OPTIMIZABLE_PROVIDERS.has(item.storageProvider)) {
      skipped += 1;
      continue;
    }

    try {
      const record = await createStoredFile({
        ownerId,
        originalName: item.originalName,
        storedName: baseNameOf(item.storageRef),
        extension: String(item.originalName || '').split('.').pop()?.toLowerCase() || '',
        mimeType: item.mimeType,
        detectedMimeType: item.mimeType,
        category: categoryFor(item.mimeType, item.originalName),
        originalSize: Number(item.fileSize) || 0,
        storageProvider: item.storageProvider,
        storageKey: item.storageRef,
        storageRef: item.storageRef,
        processingStatus: 'QUEUED',
        purpose: purpose || kind,
        source: {
          kind,
          fileId: kind === 'material' ? recordId : null,
          recordId,
          attachmentId: item.attachmentId || null,
          field: item.field || '',
        },
      });

      // A format that would be refused anyway is recorded as already-final, so
      // the storage dashboard is honest and a worker never downloads a 1 GB
      // video just to be told to keep it.
      if (!isOptimizable(item)) {
        await StoredFile.updateOne(
          { _id: record._id },
          { $set: { processingStatus: 'COMPLETED', processingMethod: 'none', storedOriginal: true } }
        );
        skipped += 1;
        continue;
      }

      recorded.push(record._id);
    } catch (err) {
      logger.warn(`[uploads] could not record an optimization job for ${item.originalName}: ${err.message}`, {
        source: 'recordBridge.record',
      });
      skipped += 1;
    }
  }

  // Enqueued only after the records exist — a job that ran before its provenance
  // was saved would have nothing to repoint.
  let queued = 0;
  for (const id of recorded) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await enqueueFileProcessing(id);
      queued += 1;
    } catch (err) {
      logger.error(err, { source: 'recordBridge.enqueue', meta: { recordId: String(recordId) } });
      // The record keeps working (it points at the original); the StoredFile is
      // marked so the dashboard is honest and POST /api/uploads/:id/retry can
      // pick it up later.
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
 * Repoints the owning record at the optimized object. Runs ONLY after a smaller,
 * VALIDATED object is already in storage; the caller deletes the original only
 * once this resolves. A failure here abandons the optimization and keeps the
 * original — which the record still points at, so nothing is ever broken.
 *
 * @param {object} record            the StoredFile being processed (reads record.source)
 * @param {object} result
 * @param {string} result.storageKey the optimized object's key
 * @param {string} result.fileUrl    its public URL
 * @param {number} result.storedSize its size in bytes
 * @returns {Promise<boolean>}
 */
export async function applyOptimizedRecord(record, { storageKey, fileUrl, storedSize, storedFileId, storageProvider }) {
  if (!record || !storageKey) return false;
  const source = record.source || {};
  const provider = storageProvider || record.storageProvider || '';

  switch (source.kind) {
    case 'material':
      return applyOptimizedMaterialAttachment({
        fileId: source.fileId,
        attachmentId: source.attachmentId,
        storageKey,
        fileUrl,
        storedSize,
        storedFileId,
      });

    case 'assignment':
      return applyToAttachmentArray(Assignment, source, { storageKey, fileUrl, storedSize, storedFileId });

    case 'submission':
      return applyToAttachmentArray(Submission, source, { storageKey, fileUrl, storedSize, storedFileId });

    case 'notice':
      return applyToNotice(source, { storageKey, fileUrl, storageProvider: provider });

    case 'question':
      return applyToQuestion(source, { storageKey, fileUrl, storageProvider: provider });

    case 'student-id':
      return applyToStudentId(source, {
        storageKey,
        fileUrl,
        storedSize,
        storageProvider: provider,
        mimeType: record.detectedMimeType || record.mimeType,
      });

    case 'document-template':
      return applyToDocumentTemplate(source, { storageKey, storedSize, mimeType: record.detectedMimeType || record.mimeType, fileName: baseNameOf(storageKey) });

    default:
      // 'standalone' and 'document-asset' own the object directly — nothing
      // external references it, so there is nothing to repoint.
      return true;
  }
}

/** Assignment / Submission share the same `attachments[]` shape. */
async function applyToAttachmentArray(Model, source, { storageKey, fileUrl, storedSize, storedFileId }) {
  if (!source.recordId || !source.attachmentId) return false;

  const doc = await Model.findById(source.recordId);
  if (!doc) return false;

  const attachment = (doc.attachments || []).id(source.attachmentId);
  if (!attachment) return false;

  // A retry of an already-applied optimization: nothing to do, and reporting
  // success is correct.
  if (attachment.storageRef === storageKey) return true;

  attachment.storageRef = storageKey;
  attachment.fileUrl = fileUrl;
  if (storedFileId && 'storedFileId' in attachment) attachment.storedFileId = storedFileId;
  doc.markModified('attachments');
  await doc.save();
  return true;
}

/** A notice has a single attachment, mirrored across four flat fields. */
async function applyToNotice(source, { storageKey, fileUrl, storageProvider }) {
  if (!source.recordId) return false;
  const notice = await Notice.findById(source.recordId);
  if (!notice) return false;
  if (notice.storageRef === storageKey) return true;

  notice.storageRef = storageKey;
  notice.attachmentUrl = fileUrl;
  if (storageProvider) notice.storageProvider = storageProvider;
  await notice.save();
  return true;
}

/** A question has a single image, mirrored across three flat fields. */
async function applyToQuestion(source, { storageKey, fileUrl, storageProvider }) {
  if (!source.recordId) return false;
  const question = await Question.findById(source.recordId);
  if (!question) return false;
  if (question.imageStorageRef === storageKey) return true;

  question.imageStorageRef = storageKey;
  question.imageUrl = fileUrl;
  if (storageProvider) question.imageStorageProvider = storageProvider;
  await question.save();
  return true;
}

/** The Student ID photo subdocument. `key` is the deletion credential. */
async function applyToStudentId(source, { storageKey, fileUrl, storedSize, storageProvider, mimeType }) {
  if (!source.recordId) return false;
  const user = await User.findById(source.recordId);
  if (!user) return false;
  if (user.studentIdImage?.key === storageKey) return true;

  // The subdocument's enum only knows imgbb/s3, so a local deployment records
  // no provider rather than an invalid value.
  const provider = storageProvider === 's3' ? 's3' : storageProvider === 'imgbb' ? 'imgbb' : '';
  user.studentIdImage = {
    provider,
    url: fileUrl,
    key: storageKey,
    bucket: user.studentIdImage?.bucket || '',
    size: Number(storedSize) || user.studentIdImage?.size || 0,
    mimeType: mimeType || user.studentIdImage?.mimeType || '',
    uploadedAt: user.studentIdImage?.uploadedAt || new Date(),
  };
  await user.save();
  return true;
}

/** The immutable template-version source file (reference design). */
async function applyToDocumentTemplate(source, { storageKey, storedSize, mimeType, fileName }) {
  if (!source.recordId) return false;
  const version = await DocumentTemplateVersion.findById(source.recordId);
  if (!version) return false;
  if (version.sourceFile?.s3Key === storageKey) return true;

  const isImage = String(mimeType || '').startsWith('image/');
  version.sourceFile = {
    type: isImage ? 'image' : 'pdf',
    s3Key: storageKey,
    fileName: fileName || version.sourceFile?.fileName || '',
    mimeType: mimeType || version.sourceFile?.mimeType || '',
    size: Number(storedSize) || version.sourceFile?.size || 0,
  };
  await version.save();
  return true;
}

export default {
  recordDomainOptimization,
  applyOptimizedRecord,
};
