import { Router } from 'express';
import { body } from 'express-validator';
import {
  createAssignment,
  updateAssignment,
  deleteAssignment,
  listMyAssignments,
  listRelevantAssignments,
  getAssignment,
  submitAssignment,
  getMySubmission,
  listMySubmissions,
  listSubmissions,
  gradeSubmission,
} from '../controllers/assignmentController.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { upload, MAX_FILES_PER_UPLOAD } from '../middleware/upload.js';

const router = Router();

const isStaff = requirePermission('assignments', { allowRoles: ['faculty'] });

router.use(authenticate);

// Static paths first — must come before the /:id catch-all routes below.
router.get('/mine', isStaff, listMyAssignments);
router.get('/my-submissions', listMySubmissions);

router.get('/', listRelevantAssignments);

router.post(
  '/',
  isStaff,
  upload.array('attachments', MAX_FILES_PER_UPLOAD),
  [
    body('title').trim().notEmpty().withMessage('Title is required'),
    body('description').trim().notEmpty().withMessage('Description is required'),
    body('deadline').notEmpty().withMessage('Deadline is required'),
    body('maxMarks').notEmpty().withMessage('Max marks is required'),
  ],
  validate,
  createAssignment
);

router.get('/:id', getAssignment);
router.patch('/:id', isStaff, upload.array('attachments', MAX_FILES_PER_UPLOAD), updateAssignment);
router.delete('/:id', isStaff, deleteAssignment);

router.post('/:id/submit', upload.array('files', MAX_FILES_PER_UPLOAD), submitAssignment);
router.get('/:id/my-submission', getMySubmission);

router.get('/:id/submissions', isStaff, listSubmissions);
router.patch('/:id/submissions/:submissionId/grade', isStaff, gradeSubmission);

export default router;
