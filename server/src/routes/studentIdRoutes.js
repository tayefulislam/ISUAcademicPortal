import { Router } from 'express';
import { submitStudentId, getMyStudentIdStatus } from '../controllers/studentApprovalController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { receiveUploads } from '../middleware/uploadStream.js';

const studentIdPhoto = receiveUploads({ fields: ['studentIdImage'], maxFiles: 1 });

const router = Router();

// Self-service only — a student's own Student ID request, always identified
// by the authenticated session (req.user), never by an id in the URL. See
// studentApprovalController.js's submitStudentId for why that alone closes
// off the "submit/resubmit someone else's request" attack this route's
// shape would otherwise invite.
router.use(authenticate, requireRole('student'));

router.get('/status', getMyStudentIdStatus);
// One handler covers both the first-ever submission (post-registration,
// registration itself no longer collects a photo) and a resubmission after
// rejection — /resubmit kept as an alias so an already-bookmarked/cached
// client URL keeps working.
router.post('/submit', studentIdPhoto, submitStudentId);
router.post('/resubmit', studentIdPhoto, submitStudentId);

export default router;
