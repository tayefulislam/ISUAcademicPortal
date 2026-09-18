import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { upload } from '../middleware/upload.js';
import {
  listTemplates,
  getTemplate,
  getMetadata,
  createTemplate,
  updateTemplate,
  createVersion,
  getVersion,
  setStatus,
  duplicateTemplate,
  deleteTemplate,
  uploadSource,
  streamSource,
} from '../controllers/adminDocumentController.js';

const router = Router();

// Template management is its own admin-tier permission, so Super Admin can hand
// a role "Document Generator" without also granting file/quiz/enrollment access.
// super_admin/administrator bypass the permission check by design.
router.use(authenticate, requirePermission('documents'));

router.get('/', listTemplates);
// Declared before /:id so the literal path is not read as an id.
router.get('/meta', getMetadata);
router.post(
  '/',
  upload.single('source'),
  [
    body('name').trim().notEmpty().withMessage('Template name is required'),
    body('category').trim().notEmpty().withMessage('A category is required'),
  ],
  validate,
  createTemplate
);

router.get('/:id', getTemplate);
router.put('/:id', updateTemplate);
router.patch('/:id/status', setStatus);
router.post('/:id/duplicate', duplicateTemplate);
router.delete('/:id', deleteTemplate);

// Versions are append-only: there is deliberately no PUT/PATCH on a version's
// fields, because a version already used to generate a document must not change
// under it.
router.post('/:id/versions', upload.single('source'), createVersion);
router.get('/:id/versions/:version', getVersion);
router.post('/:id/versions/:version/source', upload.single('source'), uploadSource);
router.get('/:id/versions/:version/source', streamSource);

export default router;
