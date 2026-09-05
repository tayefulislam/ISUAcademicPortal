import { Router } from 'express';
import { listBookmarks, addBookmark, removeBookmark } from '../controllers/bookmarkController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, listBookmarks);
router.post('/:fileId', authenticate, addBookmark);
router.delete('/:fileId', authenticate, removeBookmark);

export default router;
