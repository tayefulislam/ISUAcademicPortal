import { Router } from 'express';
import { body } from 'express-validator';
import {
  listSemesters,
  createSemester,
  updateSemester,
  deleteSemester,
} from '../controllers/semesterController.js';
import { authenticate, requireSuperAdminTier } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', listSemesters);

router.post(
  '/',
  authenticate,
  requireSuperAdminTier,
  [body('name').notEmpty(), body('code').notEmpty()],
  validate,
  createSemester
);
router.put('/:id', authenticate, requireSuperAdminTier, updateSemester);
router.delete('/:id', authenticate, requireSuperAdminTier, deleteSemester);

export default router;
