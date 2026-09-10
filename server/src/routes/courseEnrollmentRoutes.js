import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate, requirePermission, requireSuperAdminTier } from '../middleware/auth.js';
import { isAdminTierRole } from '../models/Role.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { validate } from '../middleware/validate.js';
import {
  requestEnrollment,
  listMyEnrollments,
  listMyActiveEnrollments,
  listMyPendingEnrollments,
  listEnrollments,
  getEnrollmentSummary,
  getEnrollment,
  approveEnrollment,
  rejectEnrollment,
  activateEnrollment,
  completeEnrollment,
  dropEnrollment,
  createEnrollmentDirect,
  bulkEnrollRegular,
  deleteEnrollment,
} from '../controllers/courseEnrollmentController.js';

const router = Router();

router.use(authenticate);

// Faculty keep their existing scoped access (their own assigned Department/
// Course) independent of the admin-tier permission grid — same convention
// as reviews/notices elsewhere in this app.
const canManage = requirePermission('enrollments', { allowRoles: ['faculty'] });

// Requesting/viewing your own enrollments works the same way for a Student
// or for any admin-tier role (e.g. "CR" acting as a class rep who is, at
// heart, still a student) — same precedent as Assignment submission and
// Quiz attempts, both already open to admin-tier roles.
const canActAsStudent = asyncHandler(async (req, res, next) => {
  if (req.user.role === 'student' || (await isAdminTierRole(req.user.role))) return next();
  throw new ApiError(403, 'Insufficient permissions', null, 'FORBIDDEN');
});

// ----- Student-facing (+ admin-tier acting as a student) -----
router.post(
  '/request',
  canActAsStudent,
  [
    body('courseId').notEmpty().withMessage('courseId is required'),
    body('enrollmentType').notEmpty().withMessage('enrollmentType is required'),
    body('academicYear').notEmpty().withMessage('academicYear is required'),
    body('semesterId').notEmpty().withMessage('semesterId is required'),
    body('reason').trim().notEmpty().withMessage('A reason is required'),
  ],
  validate,
  requestEnrollment
);
router.get('/my', canActAsStudent, listMyEnrollments);
router.get('/my/active', canActAsStudent, listMyActiveEnrollments);
router.get('/my/pending', canActAsStudent, listMyPendingEnrollments);

// ----- Staff -----
router.get('/', canManage, listEnrollments);
router.get('/summary', canManage, getEnrollmentSummary);
router.post(
  '/bulk-regular',
  requirePermission('enrollments'),
  [
    body('courseId').notEmpty().withMessage('courseId is required'),
    body('batchId').notEmpty().withMessage('batchId is required'),
    body('semesterId').notEmpty().withMessage('semesterId is required'),
    body('academicYear').notEmpty().withMessage('academicYear is required'),
  ],
  validate,
  bulkEnrollRegular
);
router.post(
  '/',
  requirePermission('enrollments'),
  [
    body('studentId').notEmpty().withMessage('studentId is required'),
    body('courseId').notEmpty().withMessage('courseId is required'),
    body('enrollmentType').notEmpty().withMessage('enrollmentType is required'),
    body('academicYear').notEmpty().withMessage('academicYear is required'),
    body('semesterId').notEmpty().withMessage('semesterId is required'),
  ],
  validate,
  createEnrollmentDirect
);
router.get('/:id', canManage, getEnrollment);
router.patch('/:id/approve', canManage, approveEnrollment);
router.patch('/:id/reject', canManage, [body('reason').trim().notEmpty().withMessage('A rejection reason is required')], validate, rejectEnrollment);
router.patch('/:id/activate', canManage, activateEnrollment);
router.patch('/:id/complete', canManage, completeEnrollment);
router.patch('/:id/drop', canManage, dropEnrollment);
router.delete('/:id', requireSuperAdminTier, deleteEnrollment);

export default router;
