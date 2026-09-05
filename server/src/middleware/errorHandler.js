import multer from 'multer';
import { env } from '../config/env.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ success: false, message: `Route not found: ${req.originalUrl}` });
}

const MULTER_MESSAGES = {
  LIMIT_FILE_SIZE: 'File is too large',
  LIMIT_FILE_COUNT: 'Too many files in a single upload',
  LIMIT_UNEXPECTED_FILE: 'Too many files in a single upload',
};

function duplicateKeyMessage(err) {
  const pattern = err.keyPattern || {};
  const field = Object.keys(pattern).join(', ');

  if (pattern.department && pattern.courseId) {
    return 'This course ID is already used in that department. Choose a different ID, or pick the existing course.';
  }
  if (pattern.department && pattern.batch && pattern.rollNo) {
    return 'This roll number is already registered for that department and batch.';
  }
  if (pattern.user && pattern.file) {
    return 'You already bookmarked this file.';
  }
  if (pattern.email) {
    return 'An account with this email already exists.';
  }
  return `Duplicate value for field: ${field || 'unknown'}`;
}

export function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (err instanceof multer.MulterError) {
    return res
      .status(400)
      .json({ success: false, message: MULTER_MESSAGES[err.code] || err.message, code: 'BAD_REQUEST' });
  }

  if (err.code === 11000) {
    return res.status(409).json({ success: false, message: duplicateKeyMessage(err), code: 'CONFLICT' });
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  if (statusCode >= 500) {
    console.error(err);
  }

  res.status(statusCode).json({
    success: false,
    message,
    code: err.code && typeof err.code === 'string' ? err.code : statusCode >= 500 ? 'INTERNAL_ERROR' : 'ERROR',
    details: err.details || undefined,
    stack: env.nodeEnv === 'development' ? err.stack : undefined,
  });
}
