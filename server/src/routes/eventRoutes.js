import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  getMyCalendar,
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
} from '../controllers/eventController.js';

const router = Router();
router.use(authenticate);

const canView = requirePermission('exam_view', { allowRoles: ['faculty'] });
const canCreate = requirePermission('exam_create', { allowRoles: ['faculty'] });
const canUpdate = requirePermission('exam_update', { allowRoles: ['faculty'] });
const canDelete = requirePermission('exam_delete', { allowRoles: ['faculty'] });

// Audience views — scoped by the caller's own record.
router.get('/my', getMyCalendar);

// The management listing (audience axes + scope clause).
router.get('/events', canView, listEvents);
router.post('/events', canCreate, createEvent);
router.patch('/events/:id', canUpdate, updateEvent);
router.delete('/events/:id', canDelete, deleteEvent);

export default router;
