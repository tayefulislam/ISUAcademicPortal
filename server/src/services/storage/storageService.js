import { env } from '../../config/env.js';
import { isImageMime, resolveDocumentType } from '../../utils/fileTypes.js';
import { uploadDocumentLocal, deleteDocumentLocal } from './localStorage.js';
import { uploadImageToImgbb, deleteImageFromImgbb } from './imgbbStorage.js';
import { uploadDocumentS3, deleteDocumentS3 } from './s3Storage.js';

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
    const { fileUrl, fileName, storageRef } = await uploadDocumentS3(buffer, originalName, dir);
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
  if (file.storageProvider === 's3') {
    return deleteDocumentS3(file.storageRef);
  }
  return deleteDocumentLocal(file.storageRef);
}
