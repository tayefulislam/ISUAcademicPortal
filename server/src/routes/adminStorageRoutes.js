import { Router } from 'express';
import { authenticate, requireSuperAdminTier } from '../middleware/auth.js';
import { getStorageDashboard } from '../controllers/uploadController.js';

/**
 * Admin storage dashboard (§24).
 *
 * Mounted BEFORE the generic /admin router (see routes/index.js) so the literal
 * path is matched first and never swallowed by it — the same ordering the
 * document-generator and application admin routers use.
 *
 * Read-only aggregate figures only; there is no mutation here.
 */
const router = Router();

router.get('/dashboard', authenticate, requireSuperAdminTier, getStorageDashboard);

export default router;
