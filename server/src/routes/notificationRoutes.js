import { Router } from 'express';
import {
  listNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  getPreferences,
  updatePreferences,
  getVapidKey,
  subscribe,
  unsubscribe,
} from '../controllers/notificationController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/vapid-public-key', getVapidKey);
router.post('/subscribe', subscribe);
router.delete('/subscribe', unsubscribe);

router.get('/preferences', getPreferences);
router.put('/preferences', updatePreferences);

router.get('/unread-count', getUnreadCount);
router.patch('/read-all', markAllAsRead);
router.get('/', listNotifications);
router.patch('/:id/read', markAsRead);
router.delete('/:id', deleteNotification);

export default router;
