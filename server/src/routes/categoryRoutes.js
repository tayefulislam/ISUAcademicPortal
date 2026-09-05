import { Router } from 'express';
import { body } from 'express-validator';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/categoryController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', listCategories);

router.post('/', authenticate, requireRole('super_admin'), [body('name').notEmpty()], validate, createCategory);
router.put('/:id', authenticate, requireRole('super_admin'), updateCategory);
router.delete('/:id', authenticate, requireRole('super_admin'), deleteCategory);

export default router;
