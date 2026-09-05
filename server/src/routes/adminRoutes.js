import { Router } from 'express';
import { body } from 'express-validator';
import { uploadFiles, getMyFiles, updateFile, deleteFile } from '../controllers/fileController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { upload, MAX_FILES_PER_UPLOAD } from '../middleware/upload.js';

const router = Router();

// Every route here requires an authenticated Admin (or Super Admin, who has
// every Admin capability plus more). Ownership of individual files is
// still enforced per-request inside the controllers.
router.use(authenticate, requireRole('admin', 'super_admin'));

router.get('/files', getMyFiles);
router.post(
  '/files',
  upload.array('files', MAX_FILES_PER_UPLOAD),
  [
    body('departmentId').notEmpty().withMessage('Department is required'),
    body('courseIdRef').notEmpty().withMessage('Course is required'),
    body('categoryId').notEmpty().withMessage('Category is required'),
  ],
  validate,
  uploadFiles
);
router.patch('/files/:id', updateFile);
router.delete('/files/:id', deleteFile);

export default router;
