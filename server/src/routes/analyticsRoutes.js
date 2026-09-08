import { Router } from 'express';
import { dashboard } from '../controllers/analyticsController.js';
import { authenticate, requireSuperAdminTier } from '../middleware/auth.js';

const router = Router();

router.get('/dashboard', authenticate, requireSuperAdminTier, dashboard);

export default router;
