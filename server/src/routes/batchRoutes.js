import { Router } from 'express';
import { body } from 'express-validator';
import {
  listBatches,
  getBatch,
  createBatch,
  updateBatch,
  deleteBatch,
} from '../controllers/batchController.js';
import { authenticate, requireSuperAdminTier } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', listBatches);
router.get('/:id', getBatch);

router.post('/', authenticate, requireSuperAdminTier, [body('name').notEmpty(), body('code').notEmpty()], validate, createBatch);
router.put('/:id', authenticate, requireSuperAdminTier, updateBatch);
router.delete('/:id', authenticate, requireSuperAdminTier, deleteBatch);

export default router;
