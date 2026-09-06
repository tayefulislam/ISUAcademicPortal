import { Router } from 'express';
import { body } from 'express-validator';
import { listChapters, getChapter, createChapter, updateChapter, deleteChapter } from '../controllers/chapterController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', listChapters);
router.get('/:id', getChapter);

router.post(
  '/',
  authenticate,
  requireRole('super_admin'),
  [body('name').notEmpty(), body('course').notEmpty()],
  validate,
  createChapter
);
router.put('/:id', authenticate, requireRole('super_admin'), updateChapter);
router.delete('/:id', authenticate, requireRole('super_admin'), deleteChapter);

export default router;
