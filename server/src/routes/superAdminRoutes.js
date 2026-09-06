import { Router } from 'express';
import {
  listUsers,
  getUser,
  updateUserRole,
  updateUserStatus,
  listAllFiles,
  getAnyFile,
  deleteAnyFile,
  getSystemSettings,
  updateSystemSettings,
  listFaculty,
  createFaculty,
  updateFaculty,
} from '../controllers/superAdminController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

// Every route here requires an authenticated Super Admin — enforced at the
// router level so no individual route can accidentally be left open.
router.use(authenticate, requireRole('super_admin'));

router.get('/users', listUsers);
router.get('/users/:id', getUser);
router.patch('/users/:id/role', updateUserRole);
router.patch('/users/:id/status', updateUserStatus);

router.get('/files', listAllFiles);
router.get('/files/:id', getAnyFile);
router.delete('/files/:id', deleteAnyFile);

router.get('/settings', getSystemSettings);
router.patch('/settings', updateSystemSettings);

router.get('/faculty', listFaculty);
router.post('/faculty', createFaculty);
router.patch('/faculty/:id', updateFaculty);
// Activate/deactivate reuses the existing user-status endpoint above —
// it already works for any non-super_admin target, faculty included.

export default router;
