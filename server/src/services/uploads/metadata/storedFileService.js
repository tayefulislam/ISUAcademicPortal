import StoredFile, { STORED_FILE_ACTIVE_STATUSES } from '../../../models/StoredFile.js';
import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';

/**
 * All reads and writes of StoredFile metadata go through here.
 *
 * Keeping it in one place means the status machine (QUEUED -> UPLOADING ->
 * PROCESSING -> VALIDATING -> COMPLETED | FAILED | CANCELLED) is enforced in one
 * spot, and the client-facing projection is defined once rather than reinvented
 * per controller.
 */

/** Fields stripped before a record is returned to a client. */
const INTERNAL_FIELDS = ['tempPath', 'multipart', '__v'];

/**
 * The client-facing shape — the spec's processing-result API (§23).
 * Internal workings (the temp path, the S3 uploadId, the mongoose version key)
 * are withheld; the storage key is included because the spec's response
 * includes it, and it grants nothing on its own — access is checked before any
 * URL is minted.
 */
export function sanitizeForClient(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };
  for (const field of INTERNAL_FIELDS) delete obj[field];

  obj.fileId = String(obj._id);
  // A stable, human-meaningful summary of what optimization did.
  obj.optimization = {
    method: obj.processingMethod,
    profile: obj.qualityProfile || undefined,
    compression: obj.compression || undefined,
    savedBytes: obj.savedBytes,
    savedPercentage: obj.savedPercentage,
    storedOriginal: obj.storedOriginal,
  };
  delete obj._id;
  return obj;
}

/**
 * Creates the record as soon as an upload begins, so the client has an id to
 * poll before a single byte has been processed.
 */
export async function createStoredFile(data) {
  const originalSize = Number(data.originalSize) || 0;
  return StoredFile.create({
    ownerId: data.ownerId,
    originalName: data.originalName,
    storedName: data.storedName || '',
    extension: data.extension || '',
    mimeType: data.mimeType || 'application/octet-stream',
    detectedMimeType: data.detectedMimeType || '',
    detectedLabel: data.detectedLabel || '',
    category: data.category || 'other',
    typeMismatch: Boolean(data.typeMismatch),
    originalSize,
    storedSize: originalSize,
    savedBytes: 0,
    savedPercentage: 0,
    storageProvider: data.storageProvider || (env.fileStorageProvider === 's3' ? 's3' : 'local'),
    bucket: data.bucket || env.s3.bucket || '',
    storageKey: data.storageKey || '',
    storageRef: data.storageRef || '',
    processingStatus: data.processingStatus || 'QUEUED',
    qualityProfile: data.qualityProfile || '',
    uploadMode: data.uploadMode || 'direct',
    visibility: data.visibility || 'private',
    course: data.course || null,
    department: data.department || null,
    batches: data.batches || [],
    allowedRoles: data.allowedRoles || [],
    purpose: data.purpose || 'general',
    checksum: data.checksum || '',
    pageCount: data.pageCount || 0,
    width: data.width || 0,
    height: data.height || 0,
    tempPath: data.tempPath || '',
  });
}

/** Records a completed part so an interrupted upload can resume. */
export async function recordPart(fileId, partNumber, etag) {
  return StoredFile.updateOne(
    { _id: fileId },
    {
      $push: { 'multipart.parts': { partNumber: Number(partNumber), etag: etag || '' } },
      $set: { processingStatus: 'UPLOADING' },
    }
  );
}

export async function markMultipartInitialized(fileId, { uploadId, partSizeBytes, totalParts }) {
  return StoredFile.updateOne(
    { _id: fileId },
    {
      $set: {
        uploadMode: 'multipart',
        processingStatus: 'UPLOADING',
        'multipart.uploadId': uploadId || '',
        'multipart.partSizeBytes': Number(partSizeBytes) || 0,
        'multipart.totalParts': Number(totalParts) || 0,
        'multipart.initiatedAt': new Date(),
        'multipart.parts': [],
      },
    }
  );
}

export async function markStatus(fileId, status, patch = {}) {
  return StoredFile.updateOne({ _id: fileId }, { $set: { processingStatus: status, ...patch } });
}

/**
 * Applies the outcome of a processing run: the sizes, and the "was it worth it"
 * decision the pipeline already made. `storedOriginal` is authoritative — the
 * pipeline stores exactly one of the two objects and reports which.
 */
export async function completeProcessing(fileId, result) {
  const originalSize = Number(result.originalSize) || 0;
  const storedSize = Number(result.storedSize) || 0;
  const savedBytes = Math.max(originalSize - storedSize, 0);
  const savedPercentage = originalSize > 0 ? Number(((savedBytes / originalSize) * 100).toFixed(2)) : 0;

  return StoredFile.updateOne(
    { _id: fileId },
    {
      $set: {
        processingStatus: 'COMPLETED',
        processingMethod: result.processingMethod || 'none',
        qualityProfile: result.qualityProfile || '',
        compression: result.compression || '',
        storedOriginal: result.storedOriginal !== false,
        storedSize,
        originalSize,
        savedBytes,
        savedPercentage,
        storageKey: result.storageKey,
        storageRef: result.storageRef || result.storageKey,
        etag: result.etag || '',
        pageCount: Number(result.pageCount) || 0,
        width: Number(result.width) || 0,
        height: Number(result.height) || 0,
        derivatives: result.derivatives || { thumbnail: {}, preview: {} },
        storageProvider: result.storageProvider || (env.fileStorageProvider === 's3' ? 's3' : 'local'),
        tempPath: '',
        errorCode: '',
        errorMessage: '',
        lastAttemptAt: new Date(),
      },
    }
  );
}

/**
 * Marks the run failed — WITHOUT touching the stored object. The original was
 * already uploaded before processing started (or is preserved by the pipeline),
 * so a FAILED record still has downloadable content; that is the spec's "never
 * lose the user's file because optimization failed".
 */
export async function failProcessing(fileId, { code, message } = {}) {
  return StoredFile.updateOne(
    { _id: fileId },
    {
      $set: {
        processingStatus: 'FAILED',
        errorCode: String(code || 'PROCESSING_FAILED').slice(0, 80),
        // Sanitized and bounded: an error message is echoed to the client.
        errorMessage: String(message || 'Processing failed').slice(0, 500),
        lastAttemptAt: new Date(),
      },
    }
  );
}

export async function bumpRetry(fileId) {
  return StoredFile.updateOne({ _id: fileId }, { $inc: { retryCount: 1 }, $set: { lastAttemptAt: new Date() } });
}

export async function cancel(fileId) {
  return StoredFile.updateOne({ _id: fileId }, { $set: { processingStatus: 'CANCELLED' } });
}

export async function setQueueJobId(fileId, queueJobId) {
  return StoredFile.updateOne({ _id: fileId }, { $set: { queueJobId } });
}

/** Ownership-scoped fetch: a file belonging to someone else looks absent. */
export async function findByIdForOwner(fileId, ownerId) {
  return StoredFile.findOne({ _id: fileId, ownerId });
}

export async function findById(fileId) {
  return StoredFile.findById(fileId);
}

export async function listForOwner(ownerId, { page = 1, limit = 20, category, status } = {}) {
  const filter = { ownerId };
  if (category) filter.category = category;
  if (status) filter.processingStatus = status;

  const [items, total] = await Promise.all([
    StoredFile.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    StoredFile.countDocuments(filter),
  ]);
  return { items, total, page, limit, pages: Math.ceil(total / limit) };
}

/**
 * Duplicate lookup by content hash (§19). Used in 'detect' mode to report, and
 * in 'dedupe' mode to find the object worth reusing.
 */
export async function findDuplicatesByChecksum(checksum, { excludeId } = {}) {
  if (!checksum) return [];
  const filter = { checksum, processingStatus: 'COMPLETED' };
  if (excludeId) filter._id = { $ne: excludeId };
  return StoredFile.find(filter).limit(10);
}

/** Reclaims storage for objects whose row was otherwise removed. */
export async function deleteRecord(fileId) {
  return StoredFile.deleteOne({ _id: fileId });
}

/**
 * The admin storage dashboard (§24). One aggregation for the totals, one for the
 * per-category breakdown, one for the queue — rather than a pile of count()
 * calls that would drift out of agreement with each other.
 */
export async function storageDashboard() {
  const [totalsAgg, byCategoryAgg, byStatusAgg, byProviderAgg] = await Promise.all([
    StoredFile.aggregate([
      {
        $group: {
          _id: null,
          totalFiles: { $sum: 1 },
          totalOriginalSize: { $sum: '$originalSize' },
          totalStoredSize: { $sum: '$storedSize' },
          totalSavedBytes: { $sum: '$savedBytes' },
          optimizedFiles: {
            $sum: { $cond: [{ $eq: ['$storedOriginal', false] }, 1, 0] },
          },
        },
      },
    ]),
    StoredFile.aggregate([
      {
        $group: {
          _id: '$category',
          files: { $sum: 1 },
          originalSize: { $sum: '$originalSize' },
          storedSize: { $sum: '$storedSize' },
          savedBytes: { $sum: '$savedBytes' },
        },
      },
      { $sort: { files: -1 } },
    ]),
    StoredFile.aggregate([{ $group: { _id: '$processingStatus', count: { $sum: 1 } } }]),
    StoredFile.aggregate([
      { $group: { _id: '$storageProvider', files: { $sum: 1 }, storedSize: { $sum: '$storedSize' } } },
    ]),
  ]);

  const totals = totalsAgg[0] || {
    totalFiles: 0,
    totalOriginalSize: 0,
    totalStoredSize: 0,
    totalSavedBytes: 0,
    optimizedFiles: 0,
  };

  const byCategory = {};
  for (const row of byCategoryAgg) {
    byCategory[row._id || 'other'] = {
      files: row.files,
      originalSize: row.originalSize,
      storedSize: row.storedSize,
      savedBytes: row.savedBytes,
      savedPercentage: percent(row.savedBytes, row.originalSize),
    };
  }

  const byStatus = {};
  for (const row of byStatusAgg) byStatus[row._id] = row.count;

  const byProvider = {};
  for (const row of byProviderAgg) byProvider[row._id || 'unknown'] = { files: row.files, storedSize: row.storedSize };

  // Weighted, not an average of averages: a 1 KB file must not count as much as
  // a 1 GB one when reporting the overall reduction.
  const storageReduction = percent(totals.totalSavedBytes, totals.totalOriginalSize);

  return {
    totalFiles: totals.totalFiles,
    totalOriginalSize: totals.totalOriginalSize,
    totalStoredSize: totals.totalStoredSize,
    totalSavedBytes: totals.totalSavedBytes,
    optimizedFiles: totals.optimizedFiles,
    storageReduction,
    byCategory,
    queue: {
      queued: byStatus.QUEUED || 0,
      uploading: byStatus.UPLOADING || 0,
      processing: byStatus.PROCESSING || 0,
      validating: byStatus.VALIDATING || 0,
      completed: byStatus.COMPLETED || 0,
      failed: byStatus.FAILED || 0,
      cancelled: byStatus.CANCELLED || 0,
      active: STORED_FILE_ACTIVE_STATUSES.reduce((sum, s) => sum + (byStatus[s] || 0), 0),
    },
    byProvider,
    generatedAt: new Date(),
  };
}

function percent(part, whole) {
  if (!whole) return 0;
  return Number(((part / whole) * 100).toFixed(2));
}

/**
 * Jobs that have gone quiet — still "active" but untouched since `olderThanMs`.
 * The cleanup sweep fails these so a crashed worker cannot leave a row in
 * PROCESSING forever, which would show the client a spinner that never ends.
 */
export async function expireStaleJobs(olderThanMs, { limit = 200 } = {}) {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = await StoredFile.find({
    processingStatus: { $in: STORED_FILE_ACTIVE_STATUSES },
    updatedAt: { $lt: cutoff },
  })
    .select('_id processingStatus tempPath')
    .limit(limit);

  if (!stale.length) return { expired: 0, tempPaths: [] };

  const ids = stale.map((d) => d._id);
  await StoredFile.updateMany(
    { _id: { $in: ids } },
    {
      $set: {
        processingStatus: 'FAILED',
        errorCode: 'STALE_JOB',
        errorMessage: 'Processing did not complete in time and was abandoned',
        lastAttemptAt: new Date(),
        tempPath: '',
      },
    }
  );

  const tempPaths = stale.map((d) => d.tempPath).filter(Boolean);
  logger.warn(`[uploads] expired ${ids.length} stale upload job(s)`, { source: 'storedFileService.expireStaleJobs' });
  return { expired: ids.length, tempPaths };
}

export default {
  createStoredFile,
  sanitizeForClient,
  recordPart,
  markMultipartInitialized,
  markStatus,
  completeProcessing,
  failProcessing,
  bumpRetry,
  cancel,
  setQueueJobId,
  findByIdForOwner,
  findById,
  listForOwner,
  findDuplicatesByChecksum,
  deleteRecord,
  storageDashboard,
  expireStaleJobs,
};
