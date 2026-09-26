import fs from 'node:fs/promises';
import path from 'node:path';

import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import * as storage from '../services/storage/storageService.js';
import * as storedFileService from '../services/uploads/metadata/storedFileService.js';
import { assertCanAccess, assertOwnerOrAdmin } from '../services/uploads/access/fileAccess.js';
import { buildStorageKey, contentDisposition, safeExtension } from '../services/uploads/security/filenameSanitizer.js';
import { assertConcurrencyAllowed } from '../services/uploads/security/rateLimit.js';
import { assertValidProfile } from '../services/uploads/pdf/pdfProfiles.js';
import { enqueueFileProcessing } from '../services/queue/fileProcessingQueue.js';
import { runProcessingJob, persistOriginalAndFail } from '../services/uploads/processing/processPipeline.js';
import { decompressStream } from '../services/uploads/compression/compressStream.js';

/**
 * The universal upload API.
 *
 * Two ingest paths, both non-blocking:
 *
 *   Path A — POST /uploads          : the file streams through this process to a
 *                                     spool file, and the response returns
 *                                     immediately with `{fileId, status}`. For
 *                                     files up to the multipart threshold.
 *   Path B — POST /uploads/init ...  : the client uploads parts straight to the
 *                                     bucket with presigned URLs, so a
 *                                     multi-gigabyte body never touches Node.
 *
 * Neither path processes anything inline: both enqueue a job and hand back a
 * status to poll, which is what keeps the API responsive (§2, §25).
 */

/** Whether a stored file's bytes are compressed and must be decompressed to serve. */
function isCompressed(record) {
  return Boolean(record.compression && record.compression !== 'none');
}

/** A record's terminal-ready check. */
function isReady(record) {
  return record.processingStatus === 'COMPLETED' || record.processingStatus === 'FAILED';
}

// ---------------------------------------------------------------------------
// Path A — direct streaming upload
// ---------------------------------------------------------------------------

export const createUpload = asyncHandler(async (req, res) => {
  const upload = req.upload;
  const detection = upload.detection;

  // Policy refusal happens before anything is stored. (The worker enforces this
  // again as a backstop, but the file should never get that far.)
  if (detection.dangerous) {
    await fs.rm(upload.tempPath, { force: true }).catch(() => null);
    throw new ApiError(422, `Files of this type are not permitted (${detection.label})`, null, 'UNSAFE_FILE_TYPE');
  }

  await assertConcurrencyAllowed(req.user._id);

  const profile = assertValidProfile(req.body.pdfProfile);
  const storageKey = buildStorageKey({
    purpose: req.body.purpose || 'general',
    ownerId: req.user._id,
    extension: upload.extension,
  });

  const record = await storedFileService.createStoredFile({
    ownerId: req.user._id,
    originalName: upload.originalName,
    storedName: path.basename(storageKey),
    extension: upload.extension,
    mimeType: upload.clientMime || detection.mime,
    detectedMimeType: detection.mime,
    detectedLabel: detection.label,
    category: detection.category,
    typeMismatch: detection.mismatch,
    originalSize: upload.size,
    storageKey,
    storageRef: storageKey,
    checksum: upload.checksum,
    processingStatus: 'QUEUED',
    uploadMode: 'direct',
    qualityProfile: profile,
    visibility: req.body.visibility || 'private',
    course: req.body.courseId || null,
    department: req.body.departmentId || null,
    batches: req.body.batchIds || [],
    purpose: req.body.purpose || 'general',
    tempPath: upload.tempPath,
  });

  const warnings = [];
  try {
    await enqueueFileProcessing(record._id);
  } catch (err) {
    // The queue is unreachable. The file must not be lost with it, so it is
    // stored as-is and the job is marked FAILED — retryable via POST /:id/retry.
    logger.error(err, { source: 'uploadController.enqueue', meta: { fileId: String(record._id) } });
    await persistOriginalAndFail(record._id, {
      code: 'QUEUE_UNAVAILABLE',
      message: 'Processing is temporarily unavailable; the file was stored unoptimized',
    }).catch((persistErr) => logger.error(persistErr, { source: 'uploadController.persistOriginal' }));
    warnings.push('Processing is temporarily unavailable — the file was stored as uploaded.');
  }

  const fresh = await storedFileService.findById(record._id);
  const duplicates = await detectDuplicates(fresh);

  res.status(202).json({
    success: true,
    data: storedFileService.sanitizeForClient(fresh),
    duplicates,
    warnings: warnings.length ? warnings : undefined,
  });
});

async function detectDuplicates(record) {
  if (env.uploads.dedupeMode === 'off' || !record?.checksum) return undefined;
  const matches = await storedFileService.findDuplicatesByChecksum(record.checksum, { excludeId: record._id });
  if (!matches.length) return undefined;
  return matches.map((m) => ({ fileId: String(m._id), originalName: m.originalName, storedSize: m.storedSize }));
}

// ---------------------------------------------------------------------------
// Path B — client-driven multipart upload
// ---------------------------------------------------------------------------

export const initMultipartUpload = asyncHandler(async (req, res) => {
  await assertConcurrencyAllowed(req.user._id);

  const originalName = String(req.body.originalName || '').trim();
  if (!originalName) throw new ApiError(400, 'originalName is required', null, 'VALIDATION_ERROR');

  const extension = safeExtension(path.extname(originalName));
  const declaredSize = Number(req.body.size) || 0;
  const profile = assertValidProfile(req.body.pdfProfile);

  const storageKey = buildStorageKey({
    purpose: req.body.purpose || 'general',
    ownerId: req.user._id,
    extension,
  });

  const record = await storedFileService.createStoredFile({
    ownerId: req.user._id,
    originalName,
    storedName: path.basename(storageKey),
    extension,
    mimeType: req.body.mimeType || 'application/octet-stream',
    originalSize: declaredSize,
    storageKey,
    processingStatus: 'UPLOADING',
    uploadMode: 'multipart',
    qualityProfile: profile,
    visibility: req.body.visibility || 'private',
    course: req.body.courseId || null,
    department: req.body.departmentId || null,
    purpose: req.body.purpose || 'general',
  });

  const partSizeBytes = env.uploads.partSizeMb * 1024 * 1024;
  const totalParts = declaredSize ? Math.max(1, Math.ceil(declaredSize / partSizeBytes)) : 0;

  // NOTE: the object key is created here but the multipart upload is NOT started
  // until /complete, because the actual content type is not known until the bytes
  // arrive. Starting it lazily also means an abandoned init leaves no upload to
  // bill for.
  await storedFileService.markMultipartInitialized(record._id, {
    uploadId: '',
    partSizeBytes,
    totalParts,
  });

  res.status(201).json({
    success: true,
    data: {
      fileId: String(record._id),
      status: record.processingStatus,
      partSizeBytes,
      totalParts,
      // Minted per part, on demand, and never persisted.
      viaApiPartUpload: !storage.isRemoteStorage(),
    },
  });
});

/**
 * A presigned PUT URL for one part. Called by the client as it works through the
 * parts, so a long upload can resume by asking for the URLs it still needs.
 */
export const getPartUrl = asyncHandler(async (req, res) => {
  const record = await storedFileService.findById(req.params.id);
  if (!record) throw new ApiError(404, 'Upload not found');
  assertOwnerOrAdmin(record, req.user);

  const partNumber = Number(req.body.partNumber);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    throw new ApiError(400, 'partNumber must be an integer between 1 and 10000', null, 'VALIDATION_ERROR');
  }

  // The multipart upload is started on first use, then remembered.
  let uploadId = record.multipart?.uploadId;
  if (!uploadId) {
    const created = await storage.createMultipartUpload(record.storageKey, record.mimeType);
    uploadId = created.uploadId;
    await storedFileService.markMultipartInitialized(record._id, {
      uploadId,
      partSizeBytes: record.multipart?.partSizeBytes || env.uploads.partSizeMb * 1024 * 1024,
      totalParts: record.multipart?.totalParts || 0,
    });
  }

  const presigned = await storage.presignUploadPart(record.storageKey, uploadId, partNumber);
  res.json({
    success: true,
    data: {
      partNumber,
      url: presigned.url,
      viaApi: presigned.viaApi,
      // For the local provider the client PUTs to our own API instead.
      apiPath: presigned.viaApi ? `/api/uploads/${record._id}/part/${partNumber}` : undefined,
      expiresIn: env.uploads.signedUrlTtlSeconds,
    },
  });
});

/**
 * Receives one part through our own API. This is the LOCAL-provider equivalent
 * of a direct-to-bucket PUT — there is no bucket to sign for, so the bytes come
 * through here. Streamed, so it is safe for a large part.
 */
export const receivePart = asyncHandler(async (req, res) => {
  const record = await storedFileService.findById(req.params.id);
  if (!record) throw new ApiError(404, 'Upload not found');
  assertOwnerOrAdmin(record, req.user);

  const uploadId = record.multipart?.uploadId;
  if (!uploadId) throw new ApiError(400, 'Upload has not been initialized', null, 'NOT_INITIALIZED');

  const partNumber = Number(req.params.partNumber);
  if (!Number.isInteger(partNumber) || partNumber < 1) {
    throw new ApiError(400, 'Invalid part number', null, 'VALIDATION_ERROR');
  }

  const result = await storage.writeMultipartPart(uploadId, partNumber, req);
  await storedFileService.recordPart(record._id, result.partNumber, result.etag);

  res.json({ success: true, data: { partNumber: result.partNumber, etag: result.etag } });
});

export const completeUpload = asyncHandler(async (req, res) => {
  const record = await storedFileService.findById(req.params.id);
  if (!record) throw new ApiError(404, 'Upload not found');
  assertOwnerOrAdmin(record, req.user);

  const uploadId = record.multipart?.uploadId;
  if (!uploadId) throw new ApiError(400, 'Upload has not been initialized', null, 'NOT_INITIALIZED');

  // Prefer the parts the client just reported; fall back to the ones accumulated
  // during the upload, so a resumed upload does not have to re-report them.
  const reported = Array.isArray(req.body.parts) && req.body.parts.length
    ? req.body.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag }))
    : (record.multipart?.parts || []).map((p) => ({ partNumber: p.partNumber, etag: p.etag }));

  if (!reported.length) {
    throw new ApiError(400, 'No uploaded parts were reported', null, 'NO_PARTS');
  }

  const completed = await storage.completeMultipartUpload(record.storageKey, uploadId, reported);

  const stored = await storage.getObjectMetadata(record.storageKey);
  const storedSize = stored.exists ? stored.contentLength : Number(record.originalSize) || 0;

  await storedFileService.markStatus(record._id, 'QUEUED', {
    originalSize: storedSize,
    storedSize,
    etag: completed.etag || stored.etag || '',
    storageRef: record.storageKey,
    'multipart.parts': [],
  });

  try {
    await enqueueFileProcessing(record._id);
  } catch (err) {
    logger.error(err, { source: 'uploadController.completeUpload.enqueue', meta: { fileId: String(record._id) } });
    // The bytes are already safely in storage — only the optimization is lost.
    await storedFileService.failProcessing(record._id, {
      code: 'QUEUE_UNAVAILABLE',
      message: 'Processing is temporarily unavailable; the file was stored unoptimized',
    });
  }

  const fresh = await storedFileService.findById(record._id);
  res.json({ success: true, data: storedFileService.sanitizeForClient(fresh) });
});

export const abortUpload = asyncHandler(async (req, res) => {
  const record = await storedFileService.findById(req.params.id);
  if (!record) throw new ApiError(404, 'Upload not found');
  assertOwnerOrAdmin(record, req.user);

  if (record.multipart?.uploadId) {
    await storage.abortMultipartUpload(record.storageKey, record.multipart.uploadId).catch(() => null);
  }

  await storedFileService.cancel(record._id);
  res.json({ success: true, message: 'Upload cancelled' });
});

// ---------------------------------------------------------------------------
// Status, listing, download, delete, retry
// ---------------------------------------------------------------------------

export const getUpload = asyncHandler(async (req, res) => {
  const record = await storedFileService.findById(req.params.id);
  if (!record) throw new ApiError(404, 'File not found');
  await assertCanAccess(record, req.user);
  res.json({ success: true, data: storedFileService.sanitizeForClient(record) });
});

export const listMyUploads = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const { items, total, pages } = await storedFileService.listForOwner(req.user._id, {
    page,
    limit,
    category: req.query.category,
    status: req.query.status,
  });

  res.json({
    success: true,
    data: items.map((item) => storedFileService.sanitizeForClient(item)),
    pagination: { page, limit, total, pages },
  });
});

/**
 * The download endpoint (§17).
 *
 * A compressed file MUST be decompressed on the way out, so it is proxied. An
 * uncompressed one on S3 gets a short-lived presigned URL instead and the client
 * fetches it directly — cheaper for us, and the URL expires.
 */
export const downloadUpload = asyncHandler(async (req, res) => {
  const record = await storedFileService.findById(req.params.id);
  if (!record) throw new ApiError(404, 'File not found');
  await assertCanAccess(record, req.user);

  if (!record.storageKey) throw new ApiError(409, 'This file has no stored content', null, 'NOT_STORED');
  if (!isReady(record)) {
    throw new ApiError(409, 'This file is still being processed', { status: record.processingStatus }, 'NOT_READY');
  }

  if (isCompressed(record)) {
    // No direct URL can serve the original bytes, so the client is sent to the
    // streaming proxy.
    return res.json({ success: true, data: { url: `/api/uploads/${record._id}/content`, provider: 'proxy' } });
  }

  const { url, provider } = await storage.getObjectDownloadUrl(record.storageKey, {
    downloadName: record.originalName,
    fileId: record._id,
  });
  return res.json({ success: true, data: { url, provider, expiresIn: env.uploads.signedUrlTtlSeconds } });
});

/**
 * Streams the bytes through this server, decompressing when needed.
 *
 * Same access check as everything else, so this is never a way to reach a file
 * the caller could not already GET.
 */
export const streamUploadContent = asyncHandler(async (req, res) => {
  const record = await storedFileService.findById(req.params.id);
  if (!record) throw new ApiError(404, 'File not found');
  await assertCanAccess(record, req.user);

  if (!record.storageKey) throw new ApiError(409, 'This file has no stored content', null, 'NOT_STORED');

  const { stream, contentType, contentLength } = await storage.downloadStream(record.storageKey);

  res.setHeader('Content-Type', record.detectedMimeType || record.mimeType || contentType || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition('inline', record.originalName));
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // A compressed object's stored length is not the response length.
  if (!isCompressed(record) && contentLength) res.setHeader('Content-Length', String(contentLength));

  if (isCompressed(record)) {
    stream.pipe(decompressStream(record.compression)).pipe(res);
    return;
  }
  stream.pipe(res);
});

/** Streams a generated derivative (thumbnail/preview). */
export const streamDerivative = (which) => asyncHandler(async (req, res) => {
  const record = await storedFileService.findById(req.params.id);
  if (!record) throw new ApiError(404, 'File not found');
  await assertCanAccess(record, req.user);

  const derivative = record.derivatives?.[which];
  if (!derivative?.key) throw new ApiError(404, `No ${which} is available for this file`);

  const { stream } = await storage.downloadStream(derivative.key);
  res.setHeader('Content-Type', derivative.mimeType || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  stream.pipe(res);
});

/**
 * Deletes a file: storage FIRST, then the record — the same ordering the
 * material-delete flow uses, so a storage failure leaves a record that can be
 * retried rather than an object nothing references.
 */
export const deleteUpload = asyncHandler(async (req, res) => {
  const record = await storedFileService.findById(req.params.id);
  if (!record) throw new ApiError(404, 'File not found');
  assertOwnerOrAdmin(record, req.user);

  try {
    if (record.storageKey) await storage.deleteObject(record.storageKey);
    for (const name of ['thumbnail', 'preview']) {
      const key = record.derivatives?.[name]?.key;
      if (key) await storage.deleteObject(key).catch(() => null);
    }
  } catch (err) {
    logger.error(err, { source: 'uploadController.deleteUpload', meta: { fileId: String(record._id) } });
    throw new ApiError(502, 'The stored file could not be removed, so nothing was deleted. Please retry.');
  }

  // The spool copy (if any) is now unreferenced — reclaim it immediately rather
  // than waiting for the sweeper.
  if (record.tempPath) await fs.rm(record.tempPath, { force: true }).catch(() => null);
  await storedFileService.deleteRecord(record._id);
  res.json({ success: true, message: 'File deleted' });
});

/** Re-runs processing, for a FAILED job. */
export const retryUpload = asyncHandler(async (req, res) => {
  const record = await storedFileService.findById(req.params.id);
  if (!record) throw new ApiError(404, 'File not found');
  assertOwnerOrAdmin(record, req.user);

  if (record.processingStatus === 'COMPLETED') {
    throw new ApiError(409, 'This file has already been processed', null, 'ALREADY_COMPLETED');
  }
  if (!record.tempPath && !record.storageKey) {
    throw new ApiError(409, 'The original content is no longer available to retry', null, 'NO_SOURCE');
  }

  await storedFileService.bumpRetry(record._id);
  await storedFileService.markStatus(record._id, 'QUEUED', { errorCode: '', errorMessage: '' });

  try {
    await enqueueFileProcessing(record._id);
  } catch (err) {
    // Redis is down: process it in this process rather than making the user wait
    // on a queue that is not answering.
    logger.warn(`[uploads] queue unavailable on retry, processing inline: ${err.message}`, { source: 'uploadController.retry' });
    runProcessingJob(record._id).catch((runErr) =>
      logger.error(runErr, { source: 'uploadController.retry.inline', meta: { fileId: String(record._id) } })
    );
  }

  const fresh = await storedFileService.findById(record._id);
  res.json({ success: true, data: storedFileService.sanitizeForClient(fresh) });
});

/** The admin storage dashboard (§24). */
export const getStorageDashboard = asyncHandler(async (req, res) => {
  const dashboard = await storedFileService.storageDashboard();
  res.json({ success: true, data: dashboard });
});

export default {
  createUpload,
  initMultipartUpload,
  getPartUrl,
  receivePart,
  completeUpload,
  abortUpload,
  getUpload,
  listMyUploads,
  downloadUpload,
  streamUploadContent,
  streamDerivative,
  deleteUpload,
  retryUpload,
  getStorageDashboard,
};
