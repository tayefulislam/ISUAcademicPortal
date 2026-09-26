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
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { receiveUploads } from '../middleware/uploadStream.js';

const materialFiles = receiveUploads({ fields: ['files'], maxFiles: 10, required: false });

const router = Router();

// Every route here requires an authenticated admin-tier user holding the
// relevant module permission (super_admin always passes) — Super Admin
// controls exactly who that is via the Permissions page. Ownership of
// individual files is still enforced per-request inside the controllers.
router.use(authenticate);

const canFiles = requirePermission('files');
const canApprovals = requirePermission('approvals');

router.get('/files', canFiles, getMyFiles);
router.post(
  '/files',
  canFiles,
  materialFiles,
  [
    body('departmentId').notEmpty().withMessage('Department is required'),
    body('courseIdRef').notEmpty().withMessage('Course is required'),
    body('categoryId').notEmpty().withMessage('Category is required'),
    body('visibility').optional().isIn(['public', 'login_required']),
    body('uploadType').optional().isIn(['file', 'external']),
    body('externalUrl').optional().isString(),
    body('semester').optional().isString(),
  ],
  validate,
  uploadFiles
);
router.patch('/files/:id', canFiles, updateFile);
router.delete('/files/:id', canFiles, deleteFile);

router.get('/files/:id/versions', canFiles, getFileVersions);
router.post('/files/:id/versions', canFiles, materialFiles, replaceFileVersion);

router.get('/students/pending', canApprovals, listPendingStudents);
router.get('/students/:id/id-photo', canApprovals, getStudentIdPhoto);
router.patch('/students/:id/approve', canApprovals, approveStudent);
router.patch('/students/:id/reject', canApprovals, rejectStudent);

export default router;
