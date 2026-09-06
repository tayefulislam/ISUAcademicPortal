import { Router } from 'express';
import { getFacultyScopedFiles, updateFile, deleteFile, replaceFileVersion, getFileVersions } from '../controllers/fileController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { upload, MAX_FILES_PER_UPLOAD } from '../middleware/upload.js';

const router = Router();

// A Faculty member's day-to-day file management, scoped to their assigned
// Department(s)/Course(s). updateFile/deleteFile/replaceFileVersion already
// enforce that scope internally via assertOwnership (see fileController.js).
router.use(authenticate, requireRole('faculty'));

router.get('/files', getFacultyScopedFiles);
router.patch('/files/:id', updateFile);
router.delete('/files/:id', deleteFile);
router.get('/files/:id/versions', getFileVersions);
router.post('/files/:id/versions', upload.array('files', MAX_FILES_PER_UPLOAD), replaceFileVersion);

export default router;
