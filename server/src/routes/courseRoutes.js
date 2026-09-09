import { Router } from 'express';
import { body } from 'express-validator';
import {
  listCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
  getMyCourses,
} from '../controllers/courseController.js';
import { authenticate, requireSuperAdminTier } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', listCourses);
// Registered before /:id so this literal path isn't swallowed as an id param.
router.get('/mine', authenticate, getMyCourses);
router.get('/:id', getCourse);

router.post(
  '/',
  authenticate,
  requireSuperAdminTier,
  [body('name').notEmpty(), body('courseId').notEmpty(), body('department').notEmpty()],
  validate,
  createCourse
);
router.put('/:id', authenticate, requireSuperAdminTier, updateCourse);
router.delete('/:id', authenticate, requireSuperAdminTier, deleteCourse);

export default router;
