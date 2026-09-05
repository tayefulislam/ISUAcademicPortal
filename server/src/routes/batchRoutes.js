import { Router } from 'express';
import { body } from 'express-validator';
import {
  listBatches,
  getBatch,
  createBatch,
  updateBatch,
  deleteBatch,
} from '../controllers/batchController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', listBatches);
router.get('/:id', getBatch);

router.post('/', authenticate, requireRole('admin'), [body('name').notEmpty(), body('code').notEmpty()], validate, createBatch);
router.put('/:id', authenticate, requireRole('admin'), updateBatch);
router.delete('/:id', authenticate, requireRole('admin'), deleteBatch);

export default router;
