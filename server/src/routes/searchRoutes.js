import { Router } from 'express';
import { search, suggestions } from '../controllers/searchController.js';

const router = Router();

router.get('/', search);
router.get('/suggestions', suggestions);

export default router;
