import { Router } from 'express';
import { body } from 'express-validator';
import {
  listSemesters,
  createSemester,
  updateSemester,
  deleteSemester,
} from '../controllers/semesterController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', listSemesters);

router.post(
  '/',
  authenticate,
  requireRole('super_admin'),
  [body('name').notEmpty(), body('code').notEmpty()],
  validate,
  createSemester
);
router.put('/:id', authenticate, requireRole('super_admin'), updateSemester);
router.delete('/:id', authenticate, requireRole('super_admin'), deleteSemester);

export default router;
