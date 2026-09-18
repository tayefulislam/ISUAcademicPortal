import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { listTemplates, getTemplate, autofill } from '../controllers/documentController.js';

const router = Router();

// Available to any authenticated user: each list is filtered server-side to the
// templates that user is actually eligible for (see eligibility.js), so an
// unrelated department's template is never even sent.
router.use(authenticate);
router.get('/', listTemplates);
// Declared before /:id so the literal path is not read as an id.
router.get('/:id/autofill', autofill);
router.get('/:id', getTemplate);

export default router;
