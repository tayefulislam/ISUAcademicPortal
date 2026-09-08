import { Router } from 'express';
import { body } from 'express-validator';
import { getStats, listLogs, sendNotification } from '../controllers/adminNotificationController.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.use(authenticate, requirePermission('notifications'));

router.get('/stats', getStats);
router.get('/logs', listLogs);
router.post(
  '/send',
  [
    body('scope').isIn(['user', 'course', 'department', 'all']).withMessage('scope must be one of: user, course, department, all'),
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('message').trim().notEmpty().withMessage('Message is required'),
  ],
  validate,
  sendNotification
);

export default router;
