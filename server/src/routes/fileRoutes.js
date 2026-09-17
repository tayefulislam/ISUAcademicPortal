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
  streamFilePreview,
} from '../controllers/fileController.js';
// NOTE: Admin/Super Admin file management also lives at /api/admin/files
// (see adminRoutes.js) — these routes are kept for backward compatibility
// with the existing admin panel and point at the same controllers, which
// enforce upload ownership internally regardless of which path is used.
import { authenticate, optionalAuth, requirePermission, requireStudentOrScopedAdminTier } from '../middleware/auth.js';
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
router.get('/:id/preview', optionalAuth, streamFilePreview);
router.get('/:id/related', optionalAuth, getRelatedFiles);
router.post('/:id/download', optionalAuth, recordDownload);

router.post(
  '/',
  authenticate,
  requirePermission('files'),
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
  requirePermission('files'),
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
  requireStudentOrScopedAdminTier,
  upload.array('files', MAX_FILES_PER_UPLOAD),
  [
    body('departmentId').notEmpty().withMessage('Department is required'),
    body('courseIdRef').notEmpty().withMessage('Course is required'),
    body('categoryId').notEmpty().withMessage('Category is required'),
  ],
  validate,
  submitStudentFile
);

// Editing the uploader's own material. There is deliberately no
// requirePermission('files') here: a Student (or a scoped admin-tier role
// without the files module) owns the uploads they submitted and may correct
// their details. assertOwnership inside updateFile is what scopes this to the
// caller's own uploads, and callers without staff-level file rights are held
// to descriptive fields only — they cannot set visibility, restrictions or
// status, which is the reviewer's call.
router.patch('/:id', authenticate, updateFile);

router.put('/:id', authenticate, requirePermission('files'), updateFile);
router.delete('/:id', authenticate, requirePermission('files'), deleteFile);
router.post('/bulk-delete', authenticate, requirePermission('files'), bulkDeleteFiles);

export default router;
