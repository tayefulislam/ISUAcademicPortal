import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getSettings } from '../models/Settings.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { listContacts, listConversations, startConversation, listMessages, sendMessage } from '../controllers/messageController.js';

const router = Router();

const assertMessagingEnabled = asyncHandler(async (req, res, next) => {
  const settings = await getSettings();
  if (!settings.messagingSystemEnabled) {
    throw new ApiError(403, 'Messaging is currently disabled', null, 'FORBIDDEN');
  }
  next();
});

// Students and Faculty keep their unrestricted access (unaffected by the
// admin-tier Permissions system) — only an admin-tier role (Admin, CR, ...)
// needs the 'messages' permission to use this at all.
router.use(authenticate, requirePermission('messages', { allowRoles: ['student', 'faculty'] }), assertMessagingEnabled);

router.get('/contacts', listContacts);
router.get('/conversations', listConversations);
router.post('/conversations', [body('recipientId').notEmpty().withMessage('recipientId is required')], validate, startConversation);
router.get('/conversations/:id/messages', listMessages);
router.post('/conversations/:id/messages', [body('text').trim().notEmpty().withMessage('Message text is required')], validate, sendMessage);

export default router;
