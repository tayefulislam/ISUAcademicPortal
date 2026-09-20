import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { upload, MAX_FILES_PER_UPLOAD } from '../middleware/upload.js';
import {
  getAssets,
  streamAsset,
  uploadAssets,
  deleteAssetFile,
} from '../controllers/adminDocumentController.js';

const router = Router();

// The asset library a template can draw from: the bundled university logo plus
// anything an admin uploads here. Gated by the same permission as template
// management, since choosing the library's files is part of authoring a design.
router.use(authenticate, requirePermission('documents'));

router.get('/', getAssets);
router.post('/', upload.array('files', MAX_FILES_PER_UPLOAD), uploadAssets);
router.get('/:name', streamAsset);
router.delete('/:name', deleteAssetFile);

export default router;
