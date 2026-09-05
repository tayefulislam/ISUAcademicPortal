import multer from 'multer';
import { env } from '../config/env.js';
import { isAllowedUploadMime } from '../utils/fileTypes.js';
import { ApiError } from '../utils/ApiError.js';

const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  if (!isAllowedUploadMime(file.mimetype)) {
    return cb(new ApiError(400, `Unsupported file type: ${file.mimetype}`));
  }
  cb(null, true);
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: env.maxFileSizeMb * 1024 * 1024 },
});
