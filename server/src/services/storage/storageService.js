import sharp from 'sharp';
import fs from 'fs/promises';
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
 * Resizes an image down to roughly 200-300KB (JPEG, capped at 900px on the
 * long edge) and stores it privately — used for student-ID verification
 * photos, which must never be publicly reachable.
 * @returns {Promise<string>} storageRef
 */
export async function storePrivateImage(buffer, originalName) {
  let quality = 82;
  let width = 900;
  let resized;
  try {
    resized = await sharp(buffer).resize({ width, withoutEnlargement: true }).jpeg({ quality }).toBuffer();

    // Step quality/dimensions down until under target size, or we hit a floor.
    while (resized.length > PRIVATE_IMAGE_TARGET_BYTES && (quality > 40 || width > 500)) {
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
