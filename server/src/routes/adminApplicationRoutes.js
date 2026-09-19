import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  listTypes,
  createType,
  updateType,
  deleteType,
  listRecipients,
  createRecipient,
  updateRecipient,
  deleteRecipient,
  setDepartmentHead,
  listDepartments,
  listCredits,
  adjustCredits,
  userCreditHistory,
} from '../controllers/adminApplicationController.js';

// Admin management for Write Application. Its own admin-tier permission
// (`applications`), so Super Admin can hand someone the application types and
// recipients without granting file/quiz/enrollment access. Super-admin tier
// bypasses the permission by design. Mounted BEFORE the generic /admin router.

export const adminApplicationTypeRoutes = Router();
adminApplicationTypeRoutes.use(authenticate, requirePermission('applications'));
adminApplicationTypeRoutes.get('/', listTypes);
adminApplicationTypeRoutes.post('/', [body('key').trim().notEmpty(), body('name').trim().notEmpty()], validate, createType);
adminApplicationTypeRoutes.put('/:id', updateType);
adminApplicationTypeRoutes.delete('/:id', deleteType);

export const adminApplicationRecipientRoutes = Router();
adminApplicationRecipientRoutes.use(authenticate, requirePermission('applications'));
adminApplicationRecipientRoutes.get('/', listRecipients);
adminApplicationRecipientRoutes.post('/', [body('name').trim().notEmpty()], validate, createRecipient);
adminApplicationRecipientRoutes.put('/:id', updateRecipient);
adminApplicationRecipientRoutes.delete('/:id', deleteRecipient);

// The departments and their official heads, so "Head of Department" resolves to
// the right person.
export const adminApplicationDepartmentRoutes = Router();
adminApplicationDepartmentRoutes.use(authenticate, requirePermission('applications'));
adminApplicationDepartmentRoutes.get('/', listDepartments);
adminApplicationDepartmentRoutes.put('/:id/head', setDepartmentHead);

export const adminAiCreditRoutes = Router();
adminAiCreditRoutes.use(authenticate, requirePermission('applications'));
adminAiCreditRoutes.get('/', listCredits);
adminAiCreditRoutes.get('/:userId/history', userCreditHistory);
adminAiCreditRoutes.post('/:userId/adjust', adjustCredits);

export default {
  adminApplicationTypeRoutes,
  adminApplicationRecipientRoutes,
  adminApplicationDepartmentRoutes,
  adminAiCreditRoutes,
};
