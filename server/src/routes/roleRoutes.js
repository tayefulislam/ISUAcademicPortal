import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate, requireSuperAdminTier } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { listRoles, createRole, updateRolePermissions, deleteRole } from '../controllers/roleController.js';

const router = Router();

router.use(authenticate, requireSuperAdminTier);

router.get('/', listRoles);
router.post('/', [body('name').trim().notEmpty().withMessage('Role name is required')], validate, createRole);
router.patch('/:key', updateRolePermissions);
router.delete('/:key', deleteRole);

export default router;
