import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { receiveUploadFile } from '../middleware/uploadStream.js';
import { uploadRateLimiter } from '../services/uploads/security/rateLimit.js';
import { STORED_FILE_VISIBILITIES } from '../models/StoredFile.js';
import { PDF_PROFILES } from '../services/uploads/pdf/pdfProfiles.js';
import {
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
} from '../controllers/uploadController.js';

/**
 * The universal upload API, mounted at /api/uploads.
 *
 * Every route is authenticated; ownership and visibility are enforced in the
 * controller against the record in the database (see fileAccess.js), never
 * against an id or a claim from the client.
 */
const router = Router();

router.use(authenticate);

// Shared body validators for the two "create" routes. `visibility` is
// restricted to the known set so a typo cannot silently create an
// unreadable-by-design record with an unexpected policy string.
const createValidators = [
  body('visibility').optional().isIn(STORED_FILE_VISIBILITIES).withMessage('Invalid visibility'),
  body('pdfProfile').optional().isIn(PDF_PROFILES).withMessage('Invalid PDF quality profile'),
  body('purpose').optional().isString().isLength({ max: 60 }),
  body('courseId').optional({ values: 'falsy' }).isMongoId(),
  body('departmentId').optional({ values: 'falsy' }).isMongoId(),
];

// --- Path A: direct streaming upload -------------------------------------
// The file streams to a spool file and the response returns immediately with a
// status to poll — no processing happens on the request path.
router.post('/', uploadRateLimiter, receiveUploadFile(), createValidators, validate, createUpload);

// --- Path B: client-driven multipart upload ------------------------------
// Large files never pass through this process: the client PUTs each part
// straight to the bucket with a presigned URL.
router.post(
  '/init',
  uploadRateLimiter,
  [
    body('originalName').isString().trim().notEmpty().withMessage('originalName is required'),
    body('size').optional().isInt({ min: 0 }),
    body('mimeType').optional().isString().isLength({ max: 200 }),
    ...createValidators,
  ],
  validate,
  initMultipartUpload
);

router.post(
  '/:id/part-url',
  [body('partNumber').isInt({ min: 1, max: 10000 }).withMessage('partNumber is required')],
  validate,
  getPartUrl
);

// The local-provider equivalent of a presigned PUT: the raw part body streams
// through here. Declared with no body parser — the request IS the part.
router.put('/:id/part/:partNumber', receivePart);

router.post('/:id/complete', completeUpload);
router.post('/:id/abort', abortUpload);

// --- Status, listing, content -------------------------------------------
// `/mine` is declared before `/:id` so the literal path is never read as an id.
router.get('/mine', listMyUploads);
router.get('/:id/download', downloadUpload);
router.get('/:id/content', streamUploadContent);
router.get('/:id/thumbnail', streamDerivative('thumbnail'));
router.get('/:id/preview', streamDerivative('preview'));
router.get('/:id', getUpload);
router.delete('/:id', deleteUpload);
router.post('/:id/retry', retryUpload);

export default router;
