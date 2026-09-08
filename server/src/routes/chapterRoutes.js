import { Router } from 'express';
import { body } from 'express-validator';
import { listChapters, getChapter, createChapter, updateChapter, deleteChapter } from '../controllers/chapterController.js';
import { authenticate, requireSuperAdminTier } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getSettings } from '../models/Settings.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isSuperAdminTier } from '../models/Role.js';

const router = Router();

// Editing/deleting a Chapter stays Super Admin-tier-only either way — this
// only gates who can CREATE one. Faculty may, but only while Super Admin has
// the "Faculty: Create Chapter/Topic" toggle ON; the controller separately
// checks the chapter's course is within that faculty's assigned scope.
const canCreateChapter = asyncHandler(async (req, res, next) => {
  if (isSuperAdminTier(req.user.role)) return next();
  if (req.user.role === 'faculty') {
    const settings = await getSettings();
    if (settings.facultyChapterTopicEnabled) return next();
  }
  throw new ApiError(403, 'Insufficient permissions', null, 'FORBIDDEN');
});

router.get('/', listChapters);
router.get('/:id', getChapter);

router.post(
  '/',
  authenticate,
  canCreateChapter,
  [body('name').notEmpty(), body('course').notEmpty()],
  validate,
  createChapter
);
router.put('/:id', authenticate, requireSuperAdminTier, updateChapter);
router.delete('/:id', authenticate, requireSuperAdminTier, deleteChapter);

export default router;
