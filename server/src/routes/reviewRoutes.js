import { Router } from 'express';
import { listPendingReviews, getPendingFile, approveSubmission, rejectSubmission } from '../controllers/reviewController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

// Shared review queue for Admin, Super Admin, and Faculty — each sees only
// what they're allowed to (scoping is enforced inside the controller, not
// the router, since Faculty's scope depends on their own assignment data).
router.use(authenticate, requireRole('admin', 'super_admin', 'faculty'));

router.get('/pending', listPendingReviews);
router.get('/:id', getPendingFile);
router.patch('/:id/approve', approveSubmission);
router.delete('/:id', rejectSubmission);

export default router;
