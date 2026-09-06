import { Router } from 'express';
import { search, suggestions } from '../controllers/searchController.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

router.get('/', optionalAuth, search);
router.get('/suggestions', suggestions);

export default router;
