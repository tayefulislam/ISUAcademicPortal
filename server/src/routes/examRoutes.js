import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { createEvent, getMyExams } from '../controllers/eventController.js';
import { getCurrentNext } from '../controllers/routineController.js';

// The spec's /exams and /events paths. They are aliases onto the same handlers
// the calendar uses rather than a second implementation — an exam IS an
// AcademicEvent, so duplicating the controller would only create a way for the
// two to disagree.
const router = Router();
router.use(authenticate);

const canCreate = requirePermission('exam_create', { allowRoles: ['faculty'] });

router.get('/my', getMyExams);
router.post('/', canCreate, createEvent);

export default router;
