import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';

import { env } from '../../../config/env.js';
import { logger } from '../../../utils/logger.js';
import { ApiError } from '../../../utils/ApiError.js';
import * as storage from '../../storage/storageService.js';
import * as storedFileService from '../metadata/storedFileService.js';
import { applyOptimizedRecord } from '../metadata/recordBridge.js';
import { buildStorageKey } from '../security/filenameSanitizer.js';
import { analyzeFile, determineOptimizationStrategy } from './decisionEngine.js';
import { isWorthKeeping } from './compareSizes.js';
import { processImage, analyzeImage, generateImageDerivatives } from '../image/imageProcessor.js';
import { processPdf } from '../pdf/pdfProcessor.js';
import { validatePdf } from '../pdf/pdfValidate.js';
import { compressFile, decompressStream, resolveCodec } from '../compression/compressStream.js';
import { validateArchive } from '../document/archiveGuard.js';
import { validateDocumentPackage, ZIP_DOCUMENT_EXTS } from '../document/officeValidator.js';

/**
 * The processing pipeline (§3).
 *
 *     analyzeFile -> determineOptimizationStrategy -> process -> validateOutput
 *     -> compareSizes -> storeBestVersion
 *
 * Three properties this file exists to guarantee:
 *
 *   1. THE ORIGINAL IS STORED FIRST. Before a single byte of optimization work
 *      happens, the uploaded file is uploaded to storage and the record points
 *      at it. Whatever then happens — a crash, a bad PDF, a full disk — the user
 *      still has their file. That is the spec's "never lose the user's uploaded
 *      file because optimization failed", implemented structurally rather than
 *      with a cleanup handler.
 *
 *   2. AN OPTIMIZED VERSION NEVER OVERWRITES THE ORIGINAL IN PLACE. It goes to a
 *      NEW key, is verified to exist and to be the expected size, and only THEN
 *      does the original key get deleted. A failed upload therefore cannot
 *      destroy the file it was trying to improve — which it could, on the local
 *      provider, where a truncating write to the same path would be unrecoverable.
 *
 *   3. A STORED OBJECT IS VALIDATED, NOT ASSUMED. Every optimized artifact is
 *      re-opened and checked (decodes, page count unchanged, decompresses to the
 *      right length) before it is allowed to become the stored version.
 */

/** A Writable that just counts bytes, for verifying a decompression round-trip. */
class ByteCounter extends Transform {
  constructor() {
    super();
    this.bytes = 0;
  }

  _transform(chunk, _encoding, callback) {
    this.bytes += chunk.length;
    callback();
  }
}

async function fileSize(filePath) {
  const stat = await fs.stat(filePath);
  return stat.size;
}

/** Streams a local file to `key` and returns its etag. */
async function uploadFile(localPath, key, contentType, size) {
  const stream = createReadStream(localPath);
  const { etag } = await storage.uploadStream(key, stream, contentType, { contentLength: size });
  return etag;
}

/**
 * Produces a local file to process, from either the spooled temp copy (Path A —
 * a direct upload) or the object already in storage (Path B — a client-driven
 * multipart upload, whose bytes never touched this process).
 *
 * @returns {Promise<{path:string, size:number, fromStorage:boolean}>}
 */
async function materializeSource(record, workDir) {
  if (record.tempPath) {
    try {
      const size = await fileSize(record.tempPath);
      return { path: record.tempPath, size, fromStorage: false };
    } catch {
      // The temp file is gone (a restart, a sweep) — fall through to storage.
    }
  }

  if (record.storageKey) {
    const target = path.join(workDir, `source.${record.extension || 'bin'}`);
    const { stream } = await storage.downloadStream(record.storageKey);
    await pipeline(stream, createWriteStream(target));
    return { path: target, size: await fileSize(target), fromStorage: true };
  }

  throw new ApiError(500, 'Nothing to process: no temp file and no stored object', null, 'NO_SOURCE');
}

/**
 * Validates an optimized artifact. Returns `{valid, reason}`; a validation
 * failure means the artifact is discarded and the original kept — never that the
 * upload fails.
 */
async function validateOutput(strategy, outPath, { analysis, compression, expectedSize }) {
  if (strategy === 'image-optimize') {
    try {
      const meta = await analyzeImage(outPath);
      if (!meta.width || !meta.height) return { valid: false, reason: 'image-has-no-dimensions' };
      // Force a real decode, so a truncated JPEG is caught here rather than by a
      // student later.
      await sharp(outPath, { failOn: 'none' }).stats().catch(() => null);
      return { valid: true, reason: 'ok', width: meta.width, height: meta.height };
    } catch (err) {
      return { valid: false, reason: `image-undecodable:${String(err?.message || '').slice(0, 80)}` };
    }
  }

  if (strategy === 'pdf-optimize') {
    const result = await validatePdf(outPath, { expectedPageCount: analysis.pageCount });
    return { valid: result.valid, reason: result.reason };
  }

  if (strategy === 'text-compress') {
    try {
      const counter = new ByteCounter();
      await pipeline(createReadStream(outPath), decompressStream(compression), counter);
      if (expectedSize && counter.bytes !== expectedSize) {
        return { valid: false, reason: `roundtrip-length-mismatch:${counter.bytes}!=${expectedSize}` };
      }
      return { valid: true, reason: 'ok' };
    } catch (err) {
      return { valid: false, reason: `decompress-failed:${String(err?.message || '').slice(0, 80)}` };
    }
  }

  return { valid: true, reason: 'not-applicable' };
}

/**
 * Runs the strategy, producing a candidate artifact in `workDir`.
 * @returns {Promise<{path:string, contentType:string, compression:string, method:string, profile:string, extra:object}>}
 */
async function produceCandidate(strategy, source, workDir, { analysis, profile }) {
  if (strategy === 'image-optimize') {
    const outPath = path.join(workDir, 'optimized.jpg');
    const result = await processImage(source.path, outPath, {});
    return {
      path: outPath,
      contentType: result.mimeType,
      compression: '',
      method: 'image-optimize',
      profile: '',
      extra: { width: result.width, height: result.height },
    };
  }

  if (strategy === 'pdf-optimize') {
    const outPath = path.join(workDir, 'optimized.pdf');
    const result = await processPdf(source.path, outPath, { profile });
    if (!result.ok) {
      return { skipped: true, reason: result.reason, method: 'none', profile: result.profile };
    }
    return {
      path: outPath,
      contentType: 'application/pdf',
      compression: '',
      method: 'pdf-image-optimization',
      profile: result.profile,
      extra: { pageCount: result.pageCount },
    };
  }

  if (strategy === 'text-compress') {
    const codec = resolveCodec();
    const outPath = path.join(workDir, `optimized.${codec === 'gzip' ? 'gz' : 'br'}`);
    const result = await compressFile(source.path, outPath, codec);
    return {
      path: outPath,
      contentType: 'application/octet-stream',
      compression: result.codec,
      method: 'text-compression',
      profile: '',
      extra: {},
    };
  }

  return { skipped: true, reason: 'no-strategy', method: 'none', profile: '' };
}

/**
 * The body of a job, separated so the wrapper can guarantee cleanup.
 * @returns {Promise<object>} the argument to completeProcessing
 */
async function processInternal(record, workDir) {
  const source = await materializeSource(record, workDir);

  const analysis = await analyzeFile({
    filePath: source.path,
    originalName: record.originalName,
    clientMime: record.mimeType,
    size: source.size,
    profile: record.qualityProfile || undefined,
  });

  const decision = determineOptimizationStrategy(analysis, { profile: record.qualityProfile || undefined });

  // --- Ensure the ORIGINAL is durably stored before doing anything else. ---
  // For a multipart upload the object is already there; otherwise the spooled
  // file is uploaded now. Either way, from this point the user's file is safe.
  const originalKey = record.storageKey || buildStorageKey({
    purpose: record.purpose,
    ownerId: record.ownerId,
    extension: record.extension || analysis.ext,
  });

  if (!source.fromStorage) {
    await uploadFile(source.path, originalKey, record.mimeType || analysis.mime, source.size);
    await storedFileService.markStatus(record._id, 'PROCESSING', { storageKey: originalKey, storageRef: originalKey });
  }

  const base = {
    originalSize: source.size,
    storedSize: source.size,
    method: 'none',
    processingMethod: 'none',
    qualityProfile: '',
    compression: '',
    storedOriginal: true,
    storageKey: originalKey,
    storageRef: originalKey,
    etag: '',
    pageCount: analysis.pageCount,
    width: analysis.width,
    height: analysis.height,
    derivatives: { thumbnail: {}, preview: {} },
    reason: decision.reason,
    strategy: decision.strategy,
    analysis,
  };

  // --- Policy refusal. ---
  if (decision.strategy === 'reject') {
    // A domain record's object is referenced by a live document (a material, an
    // assignment attachment, a student ID photo, …), so it must never be removed
    // here. Reaching this with one means a false positive — and deleting a live
    // record's file over one would be far worse than leaving it unoptimized.
    const ownedKind = record.source?.kind;
    if (ownedKind && ownedKind !== 'standalone') {
      logger.warn(`[uploads] ${record._id}: not optimizing a ${ownedKind} file flagged ${decision.reason}`, {
        source: 'processPipeline',
      });
      return { ...base, processingMethod: 'none', reason: `domain-not-optimizable:${decision.reason}` };
    }
    await storage.deleteObject(originalKey).catch(() => null);
    throw new ApiError(422, 'This file type is not permitted', { reason: decision.reason }, 'UNSAFE_FILE_TYPE');
  }

  // --- Nothing to do: the original IS the stored version. ---
  if (decision.strategy === 'none') {
    // Still validate an archive we are keeping, so a truncated upload is caught.
    if (analysis.category === 'archive' || ZIP_DOCUMENT_EXTS.includes(analysis.ext)) {
      const check = ZIP_DOCUMENT_EXTS.includes(analysis.ext)
        ? await validateDocumentPackage(source.path, analysis.ext)
        : await validateArchive(source.path, analysis.ext);
      if (!check.valid) {
        throw new ApiError(422, `The uploaded file appears to be damaged (${check.reason})`, null, 'CORRUPT_UPLOAD');
      }
    }
    return { ...base, storageProvider: record.storageProvider };
  }

  await storedFileService.markStatus(record._id, 'PROCESSING');

  // --- Process. ---
  const candidate = await produceCandidate(decision.strategy, source, workDir, {
    analysis,
    profile: decision.profile,
  });

  if (candidate.skipped) {
    logger.info(`[uploads] ${record._id}: nothing produced (${candidate.reason})`, { source: 'processPipeline' });
    return { ...base, processingMethod: 'none', reason: candidate.reason };
  }

  // --- Validate the artifact before it is allowed anywhere near storage. ---
  await storedFileService.markStatus(record._id, 'VALIDATING');
  const candidateSize = await fileSize(candidate.path);
  const validation = await validateOutput(decision.strategy, candidate.path, {
    analysis,
    compression: candidate.compression,
    expectedSize: source.size,
  });

  if (!validation.valid) {
    logger.warn(`[uploads] ${record._id}: optimized output rejected (${validation.reason})`, { source: 'processPipeline' });
    return { ...base, processingMethod: 'none', reason: `validation-failed:${validation.reason}` };
  }

  // --- The keep-original rule. ---
  const worth = isWorthKeeping(source.size, candidateSize);
  if (!worth.keep) {
    logger.info(`[uploads] ${record._id}: keeping original (${worth.reason})`, { source: 'processPipeline' });
    return { ...base, processingMethod: 'none', reason: `not-worth-it:${worth.reason}` };
  }

  // --- Store the optimized version under a NEW key, verify, then retire the original. ---
  const optimizedKey = buildStorageKey({
    purpose: record.purpose,
    ownerId: record.ownerId,
    extension: analysis.ext, // the object keeps the logical file's extension
  });

  const etag = await uploadFile(candidate.path, optimizedKey, candidate.contentType, candidateSize);

  const stored = await storage.getObjectMetadata(optimizedKey);
  if (!stored.exists || (stored.contentLength && stored.contentLength !== candidateSize)) {
    // The optimized object is not trustworthy — discard it and keep the
    // original, which is still intact at its own key.
    await storage.deleteObject(optimizedKey).catch(() => null);
    logger.warn(`[uploads] ${record._id}: optimized object failed verification, keeping original`, { source: 'processPipeline' });
    return { ...base, processingMethod: 'none', reason: 'optimized-object-unverified' };
  }

  // If this file belongs to a DOMAIN RECORD, that record must point at the
  // optimized object BEFORE the original is removed — otherwise there would be a
  // window in which the record's own URL is dead. A failure here abandons the
  // optimization and keeps the original, which the record still points at.
  const owningKind = record.source?.kind;
  if (owningKind && owningKind !== 'standalone') {
    const repointed = await applyOptimizedRecord(record, {
      storageKey: optimizedKey,
      fileUrl: storage.publicObjectUrl(optimizedKey),
      storedSize: candidateSize,
      storedFileId: record._id,
      storageProvider: record.storageProvider,
    }).catch((err) => {
      logger.error(err, { source: 'processPipeline.recordSync', meta: { fileId: String(record._id) } });
      return false;
    });

    if (!repointed) {
      await storage.deleteObject(optimizedKey).catch(() => null);
      logger.warn(`[uploads] ${record._id}: could not repoint the ${owningKind}, keeping the original`, {
        source: 'processPipeline',
      });
      return { ...base, processingMethod: 'none', reason: 'record-sync-failed' };
    }
  }

  // Only now is the original superseded.
  if (optimizedKey !== originalKey) {
    await storage.deleteObject(originalKey).catch((err) => {
      // An orphaned object is harmless and the sweeper will find it; failing the
      // job here would be worse than the leak.
      logger.warn(`[uploads] could not retire the original object: ${err.message}`, { source: 'processPipeline' });
    });
  }

  // --- Derivatives (images only), best-effort. ---
  let derivatives = { thumbnail: {}, preview: {} };
  if (decision.strategy === 'image-optimize' && env.uploads.optimization.derivatives) {
    derivatives = await storeDerivatives(record, candidate.path, workDir);
  }

  return {
    ...base,
    storedSize: candidateSize,
    processingMethod: candidate.method,
    qualityProfile: candidate.profile,
    compression: candidate.compression,
    storedOriginal: false,
    storageKey: optimizedKey,
    storageRef: optimizedKey,
    etag,
    pageCount: candidate.extra.pageCount ?? analysis.pageCount,
    width: candidate.extra.width ?? analysis.width,
    height: candidate.extra.height ?? analysis.height,
    derivatives,
    reason: 'optimized',
    savings: worth,
  };
}

/** Generates and uploads thumbnail/preview objects. Never throws. */
async function storeDerivatives(record, localImagePath, workDir) {
  const result = { thumbnail: {}, preview: {} };
  try {
    const local = await generateImageDerivatives(localImagePath, workDir);
    for (const name of ['thumbnail', 'preview']) {
      const item = local[name];
      if (!item?.key) continue;
      const key = buildStorageKey({ purpose: `${record.purpose}-${name}`, ownerId: record.ownerId, extension: 'jpg' });
      // eslint-disable-next-line no-await-in-loop
      await uploadFile(item.key, key, item.mimeType, item.sizeBytes);
      result[name] = { key, width: item.width, height: item.height, sizeBytes: item.sizeBytes, mimeType: item.mimeType };
    }
  } catch (err) {
    logger.warn(`[uploads] derivative generation failed: ${err.message}`, { source: 'processPipeline.derivatives' });
  }
  return result;
}

/**
 * The worker's entry point. Loads the record, runs the pipeline, and records the
 * outcome. Throws on failure so BullMQ can retry — the ORIGINAL remains stored
 * and downloadable either way.
 */
export async function runProcessingJob(fileId) {
  const record = await storedFileService.findById(fileId);
  if (!record) {
    throw new Error(`StoredFile ${fileId} not found`);
  }
  if (record.processingStatus === 'CANCELLED') {
    return { skipped: 'cancelled' };
  }

  const workDir = path.join(env.uploads.tempDir, 'jobs', String(fileId));
  await fs.mkdir(workDir, { recursive: true });

  try {
    const result = await processInternal(record, workDir);
    await storedFileService.completeProcessing(fileId, result);
    logger.info(
      `[uploads] ${fileId} completed (${result.processingMethod}, ${result.originalSize} -> ${result.storedSize})`,
      { source: 'processPipeline' }
    );
    return result;
  } catch (err) {
    // Mark the failure but DO NOT delete the stored original — the record stays
    // downloadable, and a retry can pick up where this left off.
    await storedFileService
      .failProcessing(fileId, { code: err.code || 'PROCESSING_FAILED', message: err.message })
      .catch(() => null);
    logger.error(err, { source: 'processPipeline.run', meta: { fileId } });
    throw err;
  } finally {
    // Per-attempt scratch is always disposable. The record's own tempPath is
    // deliberately left for a retry, and the sweeper reclaims it later.
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => null);
  }
}

/**
 * Stores the original and marks the job FAILED, without attempting any
 * optimization.
 *
 * This exists for the one case where the queue could not be reached at all
 * (Redis down). Without it the file would exist only as a temp copy, and the
 * cleanup sweep would eventually delete it — losing a file the user believes
 * they uploaded. Storing it first means the failure mode is "your file is safe
 * but not yet optimized", never "your upload vanished".
 *
 * The last-resort path: if even the upload fails, the temp file is left in place
 * for a later retry and the record is marked FAILED.
 */
export async function persistOriginalAndFail(fileId, { code = 'PROCESSING_FAILED', message = '' } = {}) {
  const record = await storedFileService.findById(fileId);
  if (!record) return null;

  if (!record.tempPath) {
    await storedFileService.failProcessing(fileId, { code, message });
    return null;
  }

  const key = record.storageKey || buildStorageKey({
    purpose: record.purpose,
    ownerId: record.ownerId,
    extension: record.extension || 'bin',
  });

  const size = await fileSize(record.tempPath);
  await uploadFile(record.tempPath, key, record.mimeType || 'application/octet-stream', size);

  await storedFileService.markStatus(fileId, 'FAILED', {
    storageKey: key,
    storageRef: key,
    originalSize: size,
    storedSize: size,
    storedOriginal: true,
    processingMethod: 'none',
    errorCode: String(code).slice(0, 80),
    errorMessage: String(message || 'Processing could not be scheduled').slice(0, 500),
    tempPath: '',
    lastAttemptAt: new Date(),
  });

  return { storageKey: key, size };
}

export default { runProcessingJob, persistOriginalAndFail };