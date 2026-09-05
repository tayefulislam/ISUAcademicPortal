import { Router } from 'express';
import { listBookmarks, toggleBookmark } from '../controllers/bookmarkController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Legacy paths kept for backward compatibility with existing frontend calls
// — now backed by the Bookmark collection (see /api/bookmarks for the
// spec-named equivalents) instead of the old User.favorites array.
router.get('/me/favorites', authenticate, listBookmarks);
router.post('/me/favorites/:fileId', authenticate, toggleBookmark);

export default router;
