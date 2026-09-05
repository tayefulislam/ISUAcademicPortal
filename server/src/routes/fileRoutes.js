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
} from '../controllers/fileController.js';
// NOTE: Admin/Super Admin file management also lives at /api/admin/files
// (see adminRoutes.js) — these routes are kept for backward compatibility
// with the existing admin panel and point at the same controllers, which
// enforce upload ownership internally regardless of which path is used.
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { upload, MAX_FILES_PER_UPLOAD } from '../middleware/upload.js';

const router = Router();

router.get('/', listFiles);
router.get('/stats', getStats);
router.get('/recent', getRecentFiles);
router.get('/popular', getPopularFiles);
router.get('/:id', getFile);
router.get('/:id/related', getRelatedFiles);
router.post('/:id/download', recordDownload);

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

router.put('/:id', authenticate, requireRole('admin', 'super_admin'), updateFile);
router.delete('/:id', authenticate, requireRole('admin', 'super_admin'), deleteFile);
router.post('/bulk-delete', authenticate, requireRole('admin', 'super_admin'), bulkDeleteFiles);

export default router;
