import { Router } from 'express';
import {
  listBookmarks,
  addBookmark,
  removeBookmark,
  moveBookmark,
  listFolders,
  createFolder,
  renameFolder,
  deleteFolder,
} from '../controllers/bookmarkController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// ----- Folders -----
// Registered before the '/:fileId' routes on purpose: Express matches routes in
// registration order, so otherwise a folder path would be read as a file id.
router.get('/folders', authenticate, listFolders);
router.post('/folders', authenticate, createFolder);
router.patch('/folders/:id', authenticate, renameFolder);
router.delete('/folders/:id', authenticate, deleteFolder);

// ----- Bookmark rows -----
router.get('/', authenticate, listBookmarks);
router.post('/:fileId', authenticate, addBookmark);
router.patch('/:fileId', authenticate, moveBookmark);
router.delete('/:fileId', authenticate, removeBookmark);

export default router;
