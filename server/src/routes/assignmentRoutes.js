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
  exportSubmissions,
  gradeSubmission,
} from '../controllers/assignmentController.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { receiveUploads } from '../middleware/uploadStream.js';

const router = Router();

// The same streaming intake every upload route uses, with each route's own
// field name and file count preserved so no client has to change.
const assignmentAttachments = receiveUploads({ fields: ['attachments'], maxFiles: 10, required: false });
const submissionFiles = receiveUploads({ fields: ['files'], maxFiles: 10, required: false });

const isStaff = requirePermission('assignments', { allowRoles: ['faculty'] });

router.use(authenticate);

// Static paths first — must come before the /:id catch-all routes below.
router.get('/mine', isStaff, listMyAssignments);
router.get('/my-submissions', listMySubmissions);

router.get('/', listRelevantAssignments);

router.post(
  '/',
  isStaff,
  assignmentAttachments,
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
router.patch('/:id', isStaff, assignmentAttachments, updateAssignment);
router.delete('/:id', isStaff, deleteAssignment);

router.post('/:id/submit', submissionFiles, submitAssignment);
router.get('/:id/my-submission', getMySubmission);

// Registered before /:id/submissions/:submissionId/... so this literal path
// isn't swallowed as a submissionId param.
router.get('/:id/submissions/export', isStaff, exportSubmissions);
router.get('/:id/submissions', isStaff, listSubmissions);
router.patch('/:id/submissions/:submissionId/grade', isStaff, gradeSubmission);

export default router;
