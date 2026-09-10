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
} from './localStorage.js';
import { uploadImageToImgbb, deleteImageFromImgbb } from './imgbbStorage.js';
import { uploadDocumentS3, deleteDocumentS3, uploadPrivateS3, getPrivateObjectS3 } from './s3Storage.js';
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
