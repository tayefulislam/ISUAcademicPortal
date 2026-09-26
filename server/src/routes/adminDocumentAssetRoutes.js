import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { receiveUploads } from '../middleware/uploadStream.js';

const assetFiles = receiveUploads({ fields: ['files'], maxFiles: 10, required: false });
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
router.post('/', assetFiles, uploadAssets);
router.get('/:name', streamAsset);
router.delete('/:name', deleteAssetFile);

export default router;
