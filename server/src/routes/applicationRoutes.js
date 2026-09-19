import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { body } from 'express-validator';
import { env } from '../config/env.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  listTypes,
  listRecipients,
  contextPreview,
  generate,
  aiEdit,
  aiSuggestions,
  list,
  get,
  create,
  update,
  remove,
  duplicate,
  archive,
  saveVersion,
  versions,
  generatePdf,
  generateDocx,
  listExports,
  downloadExport,
  streamExport,
  getCredits,
  getCreditHistory,
  aiStatus,
} from '../controllers/applicationController.js';

// Write Application — the applicant-facing API. Every route is authenticated;
// the applicant's identity is taken from the token, never the body.

// AI generation is the costly call, so it is the only one rate limited — per
// user, since the quota is the account's own.
const generateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.ai.generateRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? String(req.user._id) : req.ip),
  message: {
    success: false,
    message: 'Too many AI requests. Please wait a few minutes and try again.',
    code: 'TOO_MANY_REQUESTS',
  },
});

// GET /application-types
export const applicationTypeRoutes = Router();
applicationTypeRoutes.use(authenticate);
applicationTypeRoutes.get('/', listTypes);

// GET /application-recipients, GET /application-recipients/resolve
export const applicationRecipientRoutes = Router();
applicationRecipientRoutes.use(authenticate);
applicationRecipientRoutes.get('/', listRecipients);
applicationRecipientRoutes.get('/resolve', contextPreview);

// /applications
export const applicationRoutes = Router();
applicationRoutes.use(authenticate);
applicationRoutes.get('/', list);
applicationRoutes.get('/profile-preview', contextPreview);
applicationRoutes.get('/ai-status', aiStatus);
applicationRoutes.post('/generate', generateLimiter, generate);
applicationRoutes.post('/ai/edit', generateLimiter, aiEdit);
applicationRoutes.post('/suggestions', generateLimiter, aiSuggestions);
applicationRoutes.post(
  '/',
  [body('applicationType').trim().notEmpty().withMessage('An application type is required')],
  validate,
  create
);
applicationRoutes.get('/:id', get);
applicationRoutes.put('/:id', update);
applicationRoutes.delete('/:id', remove);
applicationRoutes.post('/:id/duplicate', duplicate);
applicationRoutes.post('/:id/archive', archive);
applicationRoutes.post('/:id/versions', saveVersion);
applicationRoutes.get('/:id/versions', versions);
applicationRoutes.post('/:id/generate-pdf', generatePdf);
applicationRoutes.post('/:id/generate-docx', generateDocx);
applicationRoutes.get('/:id/exports', listExports);

// /application-exports/:exportId/... — ownership + expiry checked in the service.
export const applicationExportRoutes = Router();
applicationExportRoutes.use(authenticate);
applicationExportRoutes.get('/:exportId/download', downloadExport);
applicationExportRoutes.get('/:exportId/content', streamExport);

// /ai-credits
export const aiCreditRoutes = Router();
aiCreditRoutes.use(authenticate);
aiCreditRoutes.get('/', getCredits);
aiCreditRoutes.get('/history', getCreditHistory);

export default {
  applicationTypeRoutes,
  applicationRecipientRoutes,
  applicationRoutes,
  applicationExportRoutes,
  aiCreditRoutes,
};
