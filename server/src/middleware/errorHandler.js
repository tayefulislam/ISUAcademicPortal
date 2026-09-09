import multer from 'multer';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

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
  if (pattern.rollNo) {
    return 'This Roll No / Student ID is already registered to another account.';
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

  // A malformed :id route param (not a valid 24-char hex ObjectId) throws a
  // Mongoose CastError deep inside the query layer — this used to fall
  // through to the generic 500 branch below and leak an internal stack
  // trace for what is really just a bad request, on effectively every
  // :id-parameterized route in the API.
  if (err.name === 'CastError' && err.kind === 'ObjectId') {
    return res.status(400).json({ success: false, message: 'Invalid ID', code: 'BAD_REQUEST' });
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  if (statusCode >= 500) {
    logger.error(err, { req, source: 'errorHandler', statusCode });
  }

  res.status(statusCode).json({
    success: false,
    message,
    code: err.code && typeof err.code === 'string' ? err.code : statusCode >= 500 ? 'INTERNAL_ERROR' : 'ERROR',
    details: err.details || undefined,
    stack: env.nodeEnv === 'development' ? err.stack : undefined,
  });
}
