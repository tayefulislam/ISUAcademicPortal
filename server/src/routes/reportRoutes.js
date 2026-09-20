import { Router } from 'express';
import { body, param } from 'express-validator';
import rateLimit from 'express-rate-limit';
import {
  createReport,
  listMyReports,
  listReports,
  getReport,
  updateReportStatus,
  deleteReport,
} from '../controllers/reportController.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { REPORT_ENTITY_TYPES, REPORT_REASONS, REPORT_STATUSES, REPORT_PLATFORMS } from '../models/Report.js';

const router = Router();

// Authenticated submission, rate-limited — a signed-in account shouldn't be able
// to spam the moderation queue any more than the public feedback form can.
const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many reports, please try again later', code: 'TOO_MANY_REQUESTS' },
});

// Anyone signed in may report content they can reach. The controller re-checks
// access to the target and rejects duplicate reports.
router.post(
  '/',
  reportLimiter,
  authenticate,
  [
    body('entityType').isIn(REPORT_ENTITY_TYPES).withMessage(`entityType must be one of: ${REPORT_ENTITY_TYPES.join(', ')}`),
    body('entityId').notEmpty().withMessage('entityId is required'),
    body('reason').isIn(REPORT_REASONS).withMessage(`reason must be one of: ${REPORT_REASONS.join(', ')}`),
    body('platform').isIn(REPORT_PLATFORMS).withMessage(`platform must be one of: ${REPORT_PLATFORMS.join(', ')}`),
    body('description').optional({ nullable: true }).isString().isLength({ max: 1000 }),
  ],
  validate,
  createReport
);

router.get('/mine', authenticate, listMyReports);

// The moderation queue — admin-tier roles granted the `reports` permission
// (super_admin/administrator always pass requirePermission).
router.get('/', authenticate, requirePermission('reports'), listReports);
router.get('/:id', authenticate, requirePermission('reports'), getReport);
router.patch(
  '/:id/status',
  authenticate,
  requirePermission('reports'),
  [
    body('status').isIn(REPORT_STATUSES).withMessage(`status must be one of: ${REPORT_STATUSES.join(', ')}`),
    body('resolutionNote').optional({ nullable: true }).isString().isLength({ max: 1000 }),
  ],
  validate,
  updateReportStatus
);
router.delete('/:id', authenticate, requirePermission('reports'), [param('id').notEmpty()], validate, deleteReport);

export default router;
