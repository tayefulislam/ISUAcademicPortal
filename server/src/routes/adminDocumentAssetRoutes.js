import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { getAssets, streamAsset } from '../controllers/adminDocumentController.js';

const router = Router();

// The image library a template can place (the university logo lives here).
// Gated by the same permission as template management, since choosing the images
// is part of authoring a design.
router.use(authenticate, requirePermission('documents'));

router.get('/', getAssets);
router.get('/:name', streamAsset);

export default router;
