import { Router } from 'express';
import { body } from 'express-validator';
import { createNotice, updateNotice, deleteNotice, listMyNotices, listRelevantNotices } from '../controllers/noticeController.js';
import { authenticate, optionalAuth, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { upload } from '../middleware/upload.js';

const router = Router();

const canNotices = requirePermission('notices', { allowRoles: ['faculty'] });

router.get('/', optionalAuth, listRelevantNotices);

router.use('/mine', authenticate, canNotices);
router.get('/mine', listMyNotices);

router.post(
  '/',
  authenticate,
  canNotices,
  upload.single('attachment'),
  [body('title').trim().notEmpty().withMessage('Title is required'), body('description').trim().notEmpty().withMessage('Description is required')],
  validate,
  createNotice
);
router.patch('/:id', authenticate, canNotices, upload.single('attachment'), updateNotice);
router.delete('/:id', authenticate, canNotices, deleteNotice);

export default router;
