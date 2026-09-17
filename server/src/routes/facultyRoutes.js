import { Router } from 'express';
import { body } from 'express-validator';
import {
  getFacultyScopedFiles,
  uploadFiles,
  updateFile,
  deleteFile,
  replaceFileVersion,
  getFileVersions,
} from '../controllers/fileController.js';
import { getFacultyCourses, setCourseTeachingStatus } from '../controllers/facultyController.js';
import { listPendingStudents, getStudentIdPhoto, approveStudent, rejectStudent } from '../controllers/studentApprovalController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { upload, MAX_FILES_PER_UPLOAD } from '../middleware/upload.js';
import { ApiError } from '../utils/ApiError.js';

const router = Router();

// A Faculty member's day-to-day file management, scoped to their assigned
// Department(s)/Course(s). updateFile/deleteFile/replaceFileVersion already
// enforce that scope internally via assertOwnership (see fileController.js).
router.use(authenticate, requireRole('faculty'));

// Faculty may only upload into a department/course they're actually
// assigned to — the body is client-supplied, so this is re-checked here
// against the authenticated user's own assignment, never trusted as-is.
function assertUploadScope(req, res, next) {
  const deptIds = new Set((req.user.assignedDepartments || []).map(String));
  const courseIds = new Set((req.user.assignedCourses || []).map(String));
  const { departmentId, courseIdRef } = req.body;
  if (!deptIds.has(String(departmentId)) && !courseIds.has(String(courseIdRef))) {
    return next(new ApiError(403, 'You can only upload materials for your assigned Department/Course', null, 'FORBIDDEN'));
  }
  next();
}

router.get('/courses', getFacultyCourses);
// My Courses → Activate/Deactivate. Per-faculty only (see facultyController).
router.patch('/courses/:courseId/status', [body('status').notEmpty().withMessage('status is required')], validate, setCourseTeachingStatus);

router.get('/files', getFacultyScopedFiles);
router.post(
  '/files',
  upload.array('files', MAX_FILES_PER_UPLOAD),
  [
    body('departmentId').notEmpty().withMessage('Department is required'),
    body('courseIdRef').notEmpty().withMessage('Course is required'),
    body('categoryId').notEmpty().withMessage('Category is required'),
  ],
  validate,
  assertUploadScope,
  uploadFiles
);
router.patch('/files/:id', updateFile);
router.delete('/files/:id', deleteFile);
router.get('/files/:id/versions', getFileVersions);
router.post('/files/:id/versions', upload.array('files', MAX_FILES_PER_UPLOAD), replaceFileVersion);

// Student ID approvals, scoped to this faculty member's assigned
// Department(s)/Course(s) — enforced inside the controller itself
// (studentApprovalController.js's resolveApprovalScope/assertApprovalScope
// branch on req.user.role === 'faculty'), not by anything route-level, so
// there is no separate scope check to keep in sync here.
router.get('/students/pending', listPendingStudents);
router.get('/students/:id/id-photo', getStudentIdPhoto);
router.patch('/students/:id/approve', approveStudent);
router.patch('/students/:id/reject', rejectStudent);

export default router;
