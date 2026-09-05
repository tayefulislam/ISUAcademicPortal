import { Router } from 'express';
import { dashboard } from '../controllers/analyticsController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/dashboard', authenticate, requireRole('admin'), dashboard);

export default router;
