import sharp from 'sharp';
import fs from 'fs/promises';
import { Readable } from 'stream';
import { env } from '../../config/env.js';
import { ApiError } from '../../utils/ApiError.js';
import { isImageMime, resolveDocumentType } from '../../utils/fileTypes.js';
import {
  uploadDocumentLocal,
  deleteDocumentLocal,
  uploadPrivateLocal,
  getPrivateLocalPath,
  deletePrivateLocal,
  uploadStreamLocal,
  downloadStreamLocal,
  headObjectLocal,
  deleteObjectLocal,
  createMultipartUploadLocal,
  writePartLocal,
  completeMultipartUploadLocal,
  abortMultipartUploadLocal,
  listStaleMultipartUploadsLocal,
} from './localStorage.js';
import { uploadImageToImgbb, deleteImageFromImgbb } from './imgbbStorage.js';
import {
  uploadDocumentS3,
  deleteDocumentS3,
  uploadPrivateS3,
  getPrivateObjectS3,
  putObjectS3,
  getSignedDownloadUrlS3,
  deleteObjectS3Strict,
  uploadStreamS3,
  downloadStreamS3,
  headObjectS3,
  createMultipartUploadS3,
  presignUploadPartS3,
  completeMultipartUploadS3,
  abortMultipartUploadS3,
  listStaleMultipartUploadsS3,
} from './s3Storage.js';
import { deleteFromUploadcare } from './uploadcareStorage.js';

const PRIVATE_IMAGE_TARGET_BYTES = 300 * 1024;

/**
 * Single entry point the rest of the app uses for file storage.
 * Controllers/services must depend only on this module — never on a
 * specific provider — so the provider can change via FILE_STORAGE_PROVIDER
 * without touching upload/delete call sites.
 */

/**
 * @param {Buffer} buffer
 * @param {string} originalName
 * @param {string} mimeType
 * @returns {Promise<{fileType:string, storageProvider:string, fileUrl:string, fileName:string, storageRef:string}>}
 */
export async function storeUploadedFile(buffer, originalName, mimeType) {
  if (isImageMime(mimeType)) {
    const { fileUrl, storageRef } = await uploadImageToImgbb(buffer, originalName);
    return {
      fileType: 'image',
      storageProvider: 'imgbb',
      fileUrl,
      fileName: originalName,
      storageRef,
    };
  }

  const { fileType, dir } = resolveDocumentType(mimeType, originalName);

  if (env.fileStorageProvider === 's3') {
    const { fileUrl, fileName, storageRef } = await uploadDocumentS3(buffer, originalName, dir, mimeType);
    return { fileType, storageProvider: 's3', fileUrl, fileName, storageRef };
  }

  const { fileUrl, fileName, storageRef } = await uploadDocumentLocal(buffer, originalName, dir);
  return { fileType, storageProvider: 'local', fileUrl, fileName, storageRef };
}

/**
 * @param {{storageProvider:string, storageRef:string}} file
 */
export async function deleteStoredFile(file) {
  // An external-link material has no stored object — nothing to delete.
  if (!file || file.storageProvider === 'external' || !file.storageRef) {
    return undefined;
  }
  if (file.storageProvider === 'imgbb') {
    return deleteImageFromImgbb(file.storageRef);
  }
  if (file.storageProvider === 'uploadcare') {
    return deleteFromUploadcare(file.storageRef);
  }
  if (file.storageProvider === 's3') {
    return deleteDocumentS3(file.storageRef);
  }
  return deleteDocumentLocal(file.storageRef);
}

/**
 * The same delete, but it THROWS when the object could not be removed. Used by
 * the material-delete flow, which must leave the database record in place to be
 * retried rather than deleting metadata for an object that is still in storage
 * (which would leave an orphaned file nobody can reach or clean up).
 *
 * <p>An external-link material (or anything with no storageRef) is a no-op — it
 * has no stored object to fail over.
 */
export async function deleteStoredFileStrict(file) {
  if (!file || file.storageProvider === 'external' || !file.storageRef) {
    return undefined;
  }
  if (file.storageProvider === 'imgbb') {
    return deleteImageFromImgbb(file.storageRef);
  }
  if (file.storageProvider === 'uploadcare') {
    return deleteFromUploadcare(file.storageRef);
  }
  if (file.storageProvider === 's3') {
    return deleteObjectS3Strict(file.storageRef);
  }
  return deleteDocumentLocal(file.storageRef);
}

/**
 * Resizes a buffer down to roughly 200-300KB JPEG (capped at 900px on the
 * long edge), stepping quality then dimensions down until under target or a
 * floor is hit. Shared by storePrivateImage (legacy) and
 * uploadStudentIdImage's S3 path below — S3 objects are billed/counted by
 * size and have no host-side size cap the way ImgBB effectively does, so
 * only the S3 path enforces this; ImgBB uploads go through close to
 * as-is (see uploadStudentIdImage).
 * @returns {Promise<Buffer>}
 */
async function optimizeImageToTarget(buffer, targetBytes = PRIVATE_IMAGE_TARGET_BYTES) {
  let quality = 82;
  let width = 900;
  let resized;
  try {
    resized = await sharp(buffer).resize({ width, withoutEnlargement: true }).jpeg({ quality }).toBuffer();

    // Step quality/dimensions down until under target size, or we hit a floor.
    while (resized.length > targetBytes && (quality > 40 || width > 500)) {
      if (quality > 40) quality -= 10;
      else width -= 150;
      resized = await sharp(buffer).resize({ width, withoutEnlargement: true }).jpeg({ quality }).toBuffer();
    }
  } catch {
    // A corrupted/non-image buffer makes sharp throw mid-decode (e.g.
    // "Input buffer contains unsupported image format") — this used to
    // propagate unhandled to a generic 500. The caller (registration) needs
    // a clean, expected validation error instead.
    throw new ApiError(400, 'Invalid or corrupted image file');
  }
  return resized;
}

/**
 * Legacy entry point — resizes down to ~300KB and stores under
 * env.fileStorageProvider (s3 or local). Superseded by uploadStudentIdImage
 * below (which is provider-aware via Settings.studentIdStorageProvider and
 * records full metadata), kept only so any code path still calling it (and
 * any pre-existing record read through it) keeps working unchanged.
 * @returns {Promise<string>} storageRef
 */
export async function storePrivateImage(buffer, originalName) {
  const resized = await optimizeImageToTarget(buffer);
  const jpegName = originalName.replace(/\.[^/.]+$/, '') + '.jpg';

  if (env.fileStorageProvider === 's3') {
    const { storageRef } = await uploadPrivateS3(resized, jpegName, 'private/student-ids', 'image/jpeg');
    return storageRef;
  }
  const { storageRef } = await uploadPrivateLocal(resized, jpegName, 'student-ids');
  return storageRef;
}

/**
 * Streams a private image back for an already-authorized caller
 * (admin/super_admin only — enforced by the route, not here).
 * @returns {Promise<{stream: NodeJS.ReadableStream, contentType: string}>}
 */
export async function getPrivateImageStream(storageRef) {
  if (env.fileStorageProvider === 's3') {
    return getPrivateObjectS3(storageRef);
  }
  const target = await getPrivateLocalPath(storageRef);
  const { createReadStream } = await import('fs');
  await fs.access(target);
  return { stream: createReadStream(target), contentType: 'image/jpeg' };
}

export async function deletePrivateImage(storageRef) {
  if (!storageRef) return;
  if (env.fileStorageProvider === 's3') {
    return deleteDocumentS3(storageRef); // generic key-based delete, reusable as-is
  }
  return deletePrivateLocal(storageRef);
}

// ---------------------------------------------------------------------------
// Student ID photo storage — provider-switchable (Settings.studentIdStorageProvider,
// admin-configurable; see models/Settings.js STRING_SETTINGS). This is the
// entry point the rest of the app should use going forward for Student ID
// photos (authController.js's register(), studentApprovalController.js's
// resubmitStudentId) — callers only ever see the returned
// {provider,url,key,bucket,size,mimeType,uploadedAt} shape, never which
// concrete provider module did the work.
// ---------------------------------------------------------------------------

/**
 * @param {Buffer} buffer
 * @param {string} originalName
 * @param {string} mimeType
 * @param {'imgbb'|'s3'} provider
 * @returns {Promise<{provider:string,url:string,key:string,bucket:string,size:number,mimeType:string,uploadedAt:Date}>}
 */
export async function uploadStudentIdImage(buffer, originalName, mimeType, provider) {
  if (!isImageMime(mimeType)) {
    throw new ApiError(400, 'Student ID photo must be an image (JPEG, PNG, WebP, or GIF)');
  }

  if (provider === 's3') {
    // S3 objects are billed/served by size — the spec target is ~300KB or
    // less; retried automatically by optimizeImageToTarget's quality/width
    // step-down, never simply rejected for being large.
    const optimized = await optimizeImageToTarget(buffer, PRIVATE_IMAGE_TARGET_BYTES);
    const jpegName = originalName.replace(/\.[^/.]+$/, '') + '.jpg';
    const { storageRef } = await uploadPrivateS3(optimized, jpegName, 'private/student-ids', 'image/jpeg');
    return {
      provider: 's3',
      url: '',
      key: storageRef,
      bucket: env.s3.bucket,
      size: optimized.length,
      mimeType: 'image/jpeg',
      uploadedAt: new Date(),
    };
  }

  // ImgBB hosts the original comfortably (its own multi-MB cap, not this
  // app's 300KB target — that target is an S3-storage-cost concern, not a
  // readability one) — still capped at a sane width so a multi-thousand-px
  // phone photo doesn't upload untouched, but not forced under 300KB.
  const capped = await sharp(buffer)
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer()
    .catch(() => {
      throw new ApiError(400, 'Invalid or corrupted image file');
    });
  const jpegName = originalName.replace(/\.[^/.]+$/, '') + '.jpg';
  const { fileUrl, storageRef } = await uploadImageToImgbb(capped, jpegName);
  return {
    provider: 'imgbb',
    url: fileUrl,
    key: storageRef,
    bucket: '',
    size: capped.length,
    mimeType: 'image/jpeg',
    uploadedAt: new Date(),
  };
}

/**
 * Deletes a Student ID photo from whichever provider it was actually stored
 * under (per-record `provider`, never the currently-configured setting — an
 * admin switching providers must not orphan or mis-delete older photos).
 * Best-effort: storage failures never propagate, matching the existing
 * deleteDocumentS3/deleteImageFromImgbb contract.
 * @param {{provider?:string, key?:string}|null|undefined} studentIdImage
 */
export async function deleteStudentIdImage(studentIdImage) {
  if (!studentIdImage || !studentIdImage.key) return;
  if (studentIdImage.provider === 's3') return deleteDocumentS3(studentIdImage.key);
  if (studentIdImage.provider === 'imgbb') return deleteImageFromImgbb(studentIdImage.key);
}

/**
 * Authenticated-proxy read of a Student ID photo, whichever provider it's
 * actually stored under. ImgBB URLs are technically public (that's how
 * ImgBB works), but the app still never exposes them directly to the
 * client — everything goes through this same server-side proxy stream, so
 * every provider behaves identically from the caller's point of view.
 * @param {{provider?:string, url?:string, key?:string}} studentIdImage
 * @returns {Promise<{stream: NodeJS.ReadableStream, contentType: string}>}
 */
export async function getStudentIdImageStream(studentIdImage) {
  if (studentIdImage.provider === 's3') {
    return getPrivateObjectS3(studentIdImage.key);
  }
  if (studentIdImage.provider === 'imgbb') {
    const res = await fetch(studentIdImage.url);
    if (!res.ok || !res.body) throw new ApiError(502, 'Could not fetch Student ID photo');
    // fetch's Response.body is a WHATWG ReadableStream — Express's res.pipe()
    // needs a Node Readable, hence the conversion.
    return { stream: Readable.fromWeb(res.body), contentType: res.headers.get('content-type') || 'image/jpeg' };
  }
  throw new ApiError(404, 'No ID photo on file');
}

// ---------------------------------------------------------------------------
// Generated documents (Document Generator).
//
// A generated PDF is always private: stored under a deterministic key, never
// given a public URL, and read back only through a short-lived signed URL
// minted after the caller's ownership has been checked. Only the *key* is ever
// persisted — a URL never is, so it can never leak from a database dump.
// ---------------------------------------------------------------------------

/**
 * Stores a generated PDF. For S3 the requested key is honoured exactly
 * (`generated-documents/{yyyy}/{MM}/{userId}/{jobId}.pdf`); for the local
 * development provider the file lands under `private-uploads/` (never served
 * statically) with a randomized name, and the returned `storageRef` is what the
 * caller must persist either way.
 *
 * @param {string} key
 * @param {Buffer} buffer
 * @param {string} [mimeType]
 * @returns {Promise<{storageRef:string}>}
 */
export async function storeGeneratedDocument(key, buffer, mimeType = 'application/pdf') {
  if (env.fileStorageProvider === 's3') {
    return putObjectS3(key, buffer, mimeType);
  }
  const subDir = key.replace(/\/[^/]+$/, '');
  const name = key.slice(subDir.length + 1) || 'document.pdf';
  return uploadPrivateLocal(buffer, name, subDir);
}

/**
 * A short-lived URL for one generated document.
 *
 * <p>S3 (production): a presigned URL valid for `ttlSeconds`. Local
 * (development): a relative path to the authenticated streaming route, since a
 * local file has no signature — the client fetches it with its own token.
 *
 * @returns {Promise<{url:string, provider:string}>}
 */
export async function getGeneratedDocumentUrl(key, { ttlSeconds = 300, downloadName = '', documentId = '' } = {}) {
  if (env.fileStorageProvider === 's3') {
    return { url: await getSignedDownloadUrlS3(key, ttlSeconds, downloadName), provider: 's3' };
  }
  return { url: `/api/documents/${documentId}/content`, provider: 'local' };
}

/** Best-effort delete of a generated document (the S3 lifecycle expires it anyway). */
export async function deleteGeneratedDocument(key) {
  if (!key) return;
  if (env.fileStorageProvider === 's3') {
    await deleteDocumentS3(key);
    return;
  }
  try {
    await deletePrivateLocal(key);
  } catch {
    // best-effort, as above
  }
}

/**
 * Streams a generated document back for an already-authorized caller — used by
 * the local-provider path and by the PDF preview route.
 *
 * @returns {Promise<{stream: NodeJS.ReadableStream, contentType: string}>}
 */
export async function getGeneratedDocumentStream(key, mimeType) {
  if (env.fileStorageProvider === 's3') {
    const { stream } = await getPrivateObjectS3(key);
    return { stream, contentType: mimeType || 'application/pdf' };
  }
  const target = await getPrivateLocalPath(key);
  const { createReadStream } = await import('fs');
  await fs.access(target);
  return { stream: createReadStream(target), contentType: mimeType || 'application/pdf' };
}

/**
 * A download link for an application export (a PDF/DOCX letter). Same private
 * convention as a generated document: the object is private, the URL is minted
 * per request, and with the local provider it is the authenticated streaming
 * route rather than a file path.
 *
 * @returns {Promise<{url:string, provider:string}>}
 */
export async function getApplicationExportUrl(storageRef, { ttlSeconds = 300, downloadName = '', exportId = '' } = {}) {
  if (env.fileStorageProvider === 's3') {
    return { url: await getSignedDownloadUrlS3(storageRef, ttlSeconds, downloadName), provider: 's3' };
  }
  return { url: `/api/application-exports/${exportId}/content`, provider: 'local' };
}

/**
 * Deletes one private object, throwing if it could not be removed — unlike
 * {@link deleteGeneratedDocument}, which is deliberately best-effort. The export
 * sweep needs to know, so a failed delete leaves the record retryable instead of
 * marking a file that is still there as cleaned.
 */
export async function deletePrivateObjectStrict(storageRef) {
  if (!storageRef) return;
  if (env.fileStorageProvider === 's3') {
    await deleteObjectS3Strict(storageRef);
    return;
  }
  await deletePrivateLocal(storageRef);
}

// ---------------------------------------------------------------------------
// Template reference files (the design an admin uploaded) — same private
// convention as generated documents: key only, never a public URL, read back
// through an authenticated proxy so the editor can show it as a background.
// ---------------------------------------------------------------------------

export async function storeTemplateSource(key, buffer, mimeType) {
  if (env.fileStorageProvider === 's3') {
    return putObjectS3(key, buffer, mimeType || 'application/octet-stream');
  }
  const subDir = key.replace(/\/[^/]+$/, '');
  const name = key.slice(subDir.length + 1) || 'source';
  return uploadPrivateLocal(buffer, name, subDir);
}

export async function getTemplateSourceStream(key, mimeType) {
  if (env.fileStorageProvider === 's3') {
    const { stream } = await getPrivateObjectS3(key);
    return { stream, contentType: mimeType || 'application/octet-stream' };
  }
  const target = await getPrivateLocalPath(key);
  const { createReadStream } = await import('fs');
  await fs.access(target);
  return { stream: createReadStream(target), contentType: mimeType || 'application/octet-stream' };
}

export async function deleteTemplateSource(key) {
  if (!key) return;
  if (env.fileStorageProvider === 's3') {
    await deleteDocumentS3(key);
    return;
  }
  try {
    await deletePrivateLocal(key);
  } catch {
    // best-effort, as above
  }
}

// ---------------------------------------------------------------------------
// Universal upload pipeline — the provider-agnostic streaming surface.
//
// Every function above this line takes or returns a Buffer. That is fine for a
// cover page and impossible for a 5 GB recording, so the upload pipeline talks
// to storage exclusively through the functions below, which stream in both
// directions and expose multipart for the client-driven large-file path.
//
// The single rule this module enforces: NOTHING outside services/storage may
// branch on `env.fileStorageProvider`. Callers ask for a stream, a metadata
// probe, or a part URL, and the provider is an implementation detail.
// ---------------------------------------------------------------------------

/** True when the configured provider is object storage rather than local disk. */
export function isRemoteStorage() {
  return env.fileStorageProvider === 's3';
}

/**
 * Streams a body to `<key>`. The caller owns the key (the pipeline builds a
 * namespaced, collision-free one), so nothing here generates a name.
 * @returns {Promise<{storageRef:string, etag:string}>}
 */
export async function uploadStream(key, stream, mimeType, opts = {}) {
  if (isRemoteStorage()) return uploadStreamS3(key, stream, mimeType, opts);
  return uploadStreamLocal(key, stream);
}

/**
 * Streams an object back for processing or proxying.
 * @returns {Promise<{stream:import('stream').Readable, contentType:string, contentLength:number, etag:string}>}
 */
export async function downloadStream(key, opts = {}) {
  if (isRemoteStorage()) return downloadStreamS3(key, opts);
  return downloadStreamLocal(key, opts);
}

/** Objects are stored under the private root locally, so `private` is the default there. */
function objectScope(opts = {}) {
  return { private: opts.private ?? !isRemoteStorage() };
}

export async function getObjectMetadata(key, opts = {}) {
  if (isRemoteStorage()) return headObjectS3(key);
  return headObjectLocal(key, objectScope(opts));
}

export async function objectExists(key, opts = {}) {
  const meta = await getObjectMetadata(key, opts);
  return Boolean(meta.exists);
}

export async function deleteObject(key, opts = {}) {
  if (!key) return undefined;
  if (isRemoteStorage()) return deleteDocumentS3(key);
  return deleteObjectLocal(key, objectScope(opts));
}

/** Begins a client-driven multipart upload. */
export async function createMultipartUpload(key, mimeType) {
  if (isRemoteStorage()) return createMultipartUploadS3(key, mimeType);
  return createMultipartUploadLocal(key, mimeType);
}

/**
 * A URL the CLIENT can PUT exactly one part to.
 *
 * With S3 this is a presigned URL straight to the bucket — the bytes never
 * reach this process. The local provider has no bucket to sign for, so it
 * reports `viaApi: true` and the caller proxies the part through our own API
 * instead (see POST /api/uploads/:id/part).
 *
 * @returns {Promise<{url:string, viaApi:boolean}>}
 */
export async function presignUploadPart(key, uploadId, partNumber, opts = {}) {
  if (isRemoteStorage()) {
    const url = await presignUploadPartS3(key, uploadId, partNumber, opts.ttlSeconds);
    return { url, viaApi: false };
  }
  return { url: '', viaApi: true };
}

/** Writes a part received by our own API (local provider only). */
export async function writeMultipartPart(uploadId, partNumber, stream) {
  if (isRemoteStorage()) {
    throw new ApiError(400, 'Direct part upload is only used by the local storage provider');
  }
  return writePartLocal(uploadId, partNumber, stream);
}

export async function completeMultipartUpload(key, uploadId, parts) {
  if (isRemoteStorage()) return completeMultipartUploadS3(key, uploadId, parts);
  return completeMultipartUploadLocal(key, uploadId, parts);
}

export async function abortMultipartUpload(key, uploadId) {
  if (isRemoteStorage()) return abortMultipartUploadS3(key, uploadId);
  return abortMultipartUploadLocal(uploadId);
}

/**
 * Incomplete multipart uploads older than `olderThanMs`. An abandoned upload is
 * billed for every part it left behind, so the cleanup sweep aborts these — on
 * both providers.
 */
export async function listStaleMultipartUploads(olderThanMs, prefix = '') {
  if (isRemoteStorage()) return listStaleMultipartUploadsS3(prefix, olderThanMs);
  return listStaleMultipartUploadsLocal(olderThanMs);
}

/**
 * A download URL for a stored object.
 *
 * With S3 it is presigned and short-lived — minted per request, never persisted,
 * so a database dump can never leak a working link. With local disk there is no
 * signature to mint, so it points at the authenticated proxy route instead.
 */
export async function getObjectDownloadUrl(key, { ttlSeconds = env.uploads.signedUrlTtlSeconds, downloadName = '', fileId = '' } = {}) {
  if (isRemoteStorage()) {
    return { url: await getSignedDownloadUrlS3(key, ttlSeconds, downloadName), provider: 's3' };
  }
  return { url: `/api/uploads/${fileId}/content`, provider: 'local' };
}
