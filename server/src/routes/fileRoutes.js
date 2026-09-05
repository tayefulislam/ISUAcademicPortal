import { Router } from 'express';
import { body } from 'express-validator';
import {
  uploadFile,
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
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { upload } from '../middleware/upload.js';

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
  requireRole('admin'),
  upload.single('file'),
  [
    body('departmentId').notEmpty().withMessage('Department is required'),
    body('courseIdRef').notEmpty().withMessage('Course is required'),
    body('categoryId').notEmpty().withMessage('Category is required'),
  ],
  validate,
  uploadFile
);

router.put('/:id', authenticate, requireRole('admin'), updateFile);
router.delete('/:id', authenticate, requireRole('admin'), deleteFile);
router.post('/bulk-delete', authenticate, requireRole('admin'), bulkDeleteFiles);

export default router;
