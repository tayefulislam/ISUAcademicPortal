import { Router } from 'express';
import {
  listUsers,
  exportUsers,
  getUser,
  updateUserRole,
  updateUserStatus,
  updateUserApproval,
  updateUserProfile,
  listAllFiles,
  getAnyFile,
  deleteAnyFile,
  getSystemSettings,
  updateSystemSettings,
  listFaculty,
  createFaculty,
  updateFaculty,
} from '../controllers/superAdminController.js';
import {
  listDeletionRequests,
  approveDeletionRequest,
  rejectDeletionRequest,
} from '../controllers/accountDeletionController.js';
import { listFeedback, updateFeedbackStatus, deleteFeedback, exportFeedback } from '../controllers/feedbackController.js';
import { listLogs, getLog, deleteLog, clearLogs } from '../controllers/logController.js';
import { authenticate, requireSuperAdminTier } from '../middleware/auth.js';

const router = Router();

// Every route here requires an authenticated Super Admin — enforced at the
// router level so no individual route can accidentally be left open.
router.use(authenticate, requireSuperAdminTier);

router.get('/users', listUsers);
// Registered before /users/:id so this literal path isn't swallowed as an id param.
router.get('/users/export', exportUsers);
router.get('/users/:id', getUser);
router.patch('/users/:id/role', updateUserRole);
router.patch('/users/:id/status', updateUserStatus);
router.patch('/users/:id/approval', updateUserApproval);
router.patch('/users/:id/profile', updateUserProfile);

router.get('/files', listAllFiles);
router.get('/files/:id', getAnyFile);
router.delete('/files/:id', deleteAnyFile);

router.get('/settings', getSystemSettings);
router.patch('/settings', updateSystemSettings);

// ----- Account deletion requests (Google Play's account-deletion requirement) -----
router.get('/account-deletions', listDeletionRequests);
router.post('/account-deletions/:id/approve', approveDeletionRequest);
router.post('/account-deletions/:id/reject', rejectDeletionRequest);

router.get('/faculty', listFaculty);
router.post('/faculty', createFaculty);
router.patch('/faculty/:id', updateFaculty);
// Activate/deactivate reuses the existing user-status endpoint above —
// it already works for any non-super_admin target, faculty included.

router.get('/feedback', listFeedback);
router.get('/feedback/export', exportFeedback);
router.patch('/feedback/:id/status', updateFeedbackStatus);
router.delete('/feedback/:id', deleteFeedback);

// ----- App-wide error/log viewer -----
router.get('/logs', listLogs);
router.delete('/logs', clearLogs);
router.get('/logs/:id', getLog);
router.delete('/logs/:id', deleteLog);

export default router;
