import { Router } from 'express';
import { getProfile, updateProfile } from '../controllers/profileController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, getProfile);
router.patch('/', authenticate, updateProfile);

export default router;
