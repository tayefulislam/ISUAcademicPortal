import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listCategories } from '../controllers/documentController.js';
import { createCategory } from '../controllers/adminDocumentController.js';

const router = Router();

// Read: any signed-in user (the picker needs the list).
router.get('/', authenticate, listCategories);

// Write: the Document Generator permission, so the categories an admin can add
// are governed by the same module access as the templates themselves.
router.post(
  '/',
  authenticate,
  requirePermission('documents'),
  [body('name').trim().notEmpty().withMessage('Category name is required')],
  validate,
  createCategory
);

export default router;
