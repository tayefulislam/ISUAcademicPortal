import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getSettings } from '../models/Settings.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sendBroadcastEmail, listEmailLogs, getEmailLog, listEmailContacts } from '../controllers/emailController.js';

const router = Router();

const assertEmailSystemEnabled = asyncHandler(async (req, res, next) => {
  const settings = await getSettings();
  if (!settings.emailSystemEnabled) {
    throw new ApiError(403, 'The email system is currently disabled', null, 'FORBIDDEN');
  }
  next();
});

router.use(authenticate, requirePermission('emails', { allowRoles: ['faculty'] }), assertEmailSystemEnabled);

router.get('/', listEmailLogs);
router.get('/contacts', listEmailContacts);
router.get('/:id', getEmailLog);
router.post(
  '/send',
  [body('subject').trim().notEmpty().withMessage('Subject is required'), body('body').trim().notEmpty().withMessage('Body is required')],
  validate,
  sendBroadcastEmail
);

export default router;
