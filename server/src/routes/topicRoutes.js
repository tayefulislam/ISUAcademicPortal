import { Router } from 'express';
import { body } from 'express-validator';
import { listTopics, getTopic, createTopic, updateTopic, deleteTopic } from '../controllers/topicController.js';
import { authenticate, requireSuperAdminTier } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getSettings } from '../models/Settings.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { isSuperAdminTier } from '../models/Role.js';

const router = Router();

// Editing/deleting a Topic stays Super Admin-tier-only either way — this
// only gates who can CREATE one. Faculty may, but only while Super Admin has
// the "Faculty: Create Chapter/Topic" toggle ON; the controller separately
// checks the topic's course is within that faculty's assigned scope.
const canCreateTopic = asyncHandler(async (req, res, next) => {
  if (isSuperAdminTier(req.user.role)) return next();
  if (req.user.role === 'faculty') {
    const settings = await getSettings();
    if (settings.facultyChapterTopicEnabled) return next();
  }
  throw new ApiError(403, 'Insufficient permissions', null, 'FORBIDDEN');
});

router.get('/', listTopics);
router.get('/:id', getTopic);

router.post(
  '/',
  authenticate,
  canCreateTopic,
  [body('name').notEmpty(), body('chapterId').notEmpty()],
  validate,
  createTopic
);
router.put('/:id', authenticate, requireSuperAdminTier, updateTopic);
router.delete('/:id', authenticate, requireSuperAdminTier, deleteTopic);

export default router;
