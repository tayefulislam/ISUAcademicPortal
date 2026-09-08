import { Router } from 'express';
import { body } from 'express-validator';
import {
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from '../controllers/categoryController.js';
import { authenticate, requireSuperAdminTier } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', listCategories);

router.post('/', authenticate, requireSuperAdminTier, [body('name').notEmpty()], validate, createCategory);
router.put('/:id', authenticate, requireSuperAdminTier, updateCategory);
router.delete('/:id', authenticate, requireSuperAdminTier, deleteCategory);

export default router;
