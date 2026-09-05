import { Router } from 'express';
import { body } from 'express-validator';
import {
  listDepartments,
  getDepartment,
  getDepartmentCourses,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from '../controllers/departmentController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', listDepartments);
router.get('/:id', getDepartment);
router.get('/:id/courses', getDepartmentCourses);

router.post(
  '/',
  authenticate,
  requireRole('admin'),
  [body('name').notEmpty(), body('code').notEmpty()],
  validate,
  createDepartment
);
router.put('/:id', authenticate, requireRole('admin'), updateDepartment);
router.delete('/:id', authenticate, requireRole('admin'), deleteDepartment);

export default router;
