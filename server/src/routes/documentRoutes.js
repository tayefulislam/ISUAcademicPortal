import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { body } from 'express-validator';
import { env } from '../config/env.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  preview,
  generate,
  jobStatus,
  listDocuments,
  getDocument,
  downloadDocument,
  streamDocument,
  deleteDocument,
} from '../controllers/documentController.js';

const router = Router();

// Generation is the only endpoint here that costs real work, so it is the only
// one rate limited — per user, not per IP, since the quota is the user's own.
const generateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.documents.generateRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? String(req.user._id) : req.ip),
  message: {
    success: false,
    message: 'Too many documents requested. Please wait a few minutes and try again.',
    code: 'TOO_MANY_REQUESTS',
  },
});

// Every route is authenticated; ownership is enforced per-document in the
// controller (a job belonging to someone else is indistinguishable from one
// that does not exist).
router.use(authenticate);

router.post(
  '/preview',
  [body('templateId').isMongoId().withMessage('A template is required')],
  validate,
  preview
);

router.post(
  '/generate',
  generateLimiter,
  [body('templateId').isMongoId().withMessage('A template is required')],
  validate,
  generate
);

// Declared before /:id so the literal path is not read as an id.
router.get('/jobs/:jobId', jobStatus);

router.get('/', listDocuments);
router.get('/:id/download', downloadDocument);
router.get('/:id/content', streamDocument);
router.get('/:id', getDocument);
router.delete('/:id', deleteDocument);

export default router;
