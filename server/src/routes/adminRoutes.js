import { Router } from 'express';
import { body } from 'express-validator';
import {
  uploadFiles,
  getMyFiles,
  updateFile,
  deleteFile,
  replaceFileVersion,
  getFileVersions,
} from '../controllers/fileController.js';
import {
  listPendingStudents,
  getStudentIdPhoto,
  approveStudent,
  rejectStudent,
} from '../controllers/studentApprovalController.js';
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

router.get('/files/:id/versions', getFileVersions);
router.post('/files/:id/versions', upload.array('files', MAX_FILES_PER_UPLOAD), replaceFileVersion);

router.get('/students/pending', listPendingStudents);
router.get('/students/:id/id-photo', getStudentIdPhoto);
router.patch('/students/:id/approve', approveStudent);
router.patch('/students/:id/reject', rejectStudent);

export default router;
