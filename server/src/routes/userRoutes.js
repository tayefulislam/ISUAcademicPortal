import { Router } from 'express';
import {
  listUsers,
  updateUserRole,
  setUserActive,
  toggleFavorite,
  listFavorites,
} from '../controllers/userController.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, requireRole('admin'), listUsers);
router.put('/:id/role', authenticate, requireRole('admin'), updateUserRole);
router.put('/:id/active', authenticate, requireRole('admin'), setUserActive);

router.get('/me/favorites', authenticate, listFavorites);
router.post('/me/favorites/:fileId', authenticate, toggleFavorite);

export default router;
