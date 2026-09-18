import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getCurrentNext } from '../controllers/routineController.js';

// The SmartEventWidget's single call: GET /api/events/my/current-next.
//
// Its own tiny router because the path sits under /events while the rest of the
// calendar lives under /calendar — the spec names both, and an alias is cheaper
// than contorting one router to serve two prefixes.
const router = Router();
router.use(authenticate);

router.get('/my/current-next', getCurrentNext);

export default router;
