import { Router } from 'express';
import { body } from 'express-validator';
import {
  listCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
} from '../controllers/courseController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', listCourses);
router.get('/:id', getCourse);

router.post(
  '/',
  authenticate,
  requireRole('admin'),
  [body('name').notEmpty(), body('courseId').notEmpty(), body('department').notEmpty()],
  validate,
  createCourse
);
router.put('/:id', authenticate, requireRole('admin'), updateCourse);
router.delete('/:id', authenticate, requireRole('admin'), deleteCourse);

export default router;
