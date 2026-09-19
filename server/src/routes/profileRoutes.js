import { Router } from 'express';
import { getProfile, updateProfile } from '../controllers/profileController.js';
import { getMyDeletionRequest, requestAccountDeletion } from '../controllers/accountDeletionController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, getProfile);
router.patch('/', authenticate, updateProfile);

// Account deletion — Google Play requires an app that creates accounts to let
// the account holder ask for its deletion from inside the app.
router.get('/deletion-request', authenticate, getMyDeletionRequest);
router.post('/deletion-request', authenticate, requestAccountDeletion);

export default router;
