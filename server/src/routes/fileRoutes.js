import { Router } from 'express';
import { body } from 'express-validator';
import {
  uploadFiles,
  attachUploadcareFiles,
  listFiles,
  getFile,
  recordDownload,
  getRelatedFiles,
  updateFile,
  deleteFile,
  bulkDeleteFiles,
  getRecentFiles,
  getPopularFiles,
  getStats,
  getDashboard,
  submitStudentFile,
  getMySubmittedFiles,
} from '../controllers/fileController.js';
// NOTE: Admin/Super Admin file management also lives at /api/admin/files
// (see adminRoutes.js) — these routes are kept for backward compatibility
// with the existing admin panel and point at the same controllers, which
// enforce upload ownership internally regardless of which path is used.
import { authenticate, optionalAuth, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { upload, MAX_FILES_PER_UPLOAD } from '../middleware/upload.js';

const router = Router();

// optionalAuth (not just open) so req.user is populated when a token is
// present — anonymous visitors still get public-only results.
router.get('/', optionalAuth, listFiles);
router.get('/stats', getStats);
router.get('/recent', optionalAuth, getRecentFiles);
router.get('/popular', optionalAuth, getPopularFiles);
router.get('/dashboard', authenticate, getDashboard);
router.get('/mine', authenticate, getMySubmittedFiles);
router.get('/:id', optionalAuth, getFile);
router.get('/:id/related', optionalAuth, getRelatedFiles);
router.post('/:id/download', optionalAuth, recordDownload);

router.post(
  '/',
  authenticate,
  requireRole('admin', 'super_admin'),
  upload.array('files', MAX_FILES_PER_UPLOAD),
  [
    body('departmentId').notEmpty().withMessage('Department is required'),
    body('courseIdRef').notEmpty().withMessage('Course is required'),
    body('categoryId').notEmpty().withMessage('Category is required'),
  ],
  validate,
  uploadFiles
);

router.post(
  '/from-uploadcare',
  authenticate,
  requireRole('admin', 'super_admin'),
  [
    body('departmentId').notEmpty().withMessage('Department is required'),
    body('courseIdRef').notEmpty().withMessage('Course is required'),
    body('categoryId').notEmpty().withMessage('Category is required'),
    body('files').isArray({ min: 1 }).withMessage('At least one uploaded file is required'),
  ],
  validate,
  attachUploadcareFiles
);

router.post(
  '/submit',
  authenticate,
  requireRole('student'),
  upload.array('files', MAX_FILES_PER_UPLOAD),
  [
    body('departmentId').notEmpty().withMessage('Department is required'),
    body('courseIdRef').notEmpty().withMessage('Course is required'),
    body('categoryId').notEmpty().withMessage('Category is required'),
  ],
  validate,
  submitStudentFile
);

router.put('/:id', authenticate, requireRole('admin', 'super_admin'), updateFile);
router.delete('/:id', authenticate, requireRole('admin', 'super_admin'), deleteFile);
router.post('/bulk-delete', authenticate, requireRole('admin', 'super_admin'), bulkDeleteFiles);

export default router;
