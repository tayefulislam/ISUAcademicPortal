import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  getMyRoutine,
  getTodayRoutine,
  getWeekRoutine,
  getMonthRoutine,
  getCurrentNext,
  getInstance,
  listInstances,
  listTemplates,
  getGroups,
  getFacultyForCourse,
  createRoutine,
  updateTemplate,
  deleteTemplate,
  updateInstance,
  cancelInstance,
  rescheduleInstance,
  deleteInstance,
} from '../controllers/routineController.js';

const router = Router();

// Public on purpose, and the only route here that is: the registration form has
// to offer the configured class groups BEFORE the student has a session, and it
// is the same list the routine manager reads — one endpoint, not a second one
// that could drift. It is a configuration label list (BOTH / A1 / A2 …), no more
// sensitive than the already-public /departments, /batches and /semesters.
router.get('/groups', getGroups);

// Everything below is open to any signed-in user: the audience is derived from
// their own record inside academicEventService, so a student asking for "my
// routine" can only ever receive their own. No viewer-supplied filter can widen it.
router.use(authenticate);

router.get('/my', getMyRoutine);
router.get('/today', getTodayRoutine);
router.get('/week', getWeekRoutine);
router.get('/month', getMonthRoutine);

// Which faculty member teaches a course, so the routine form can preselect them.
router.get('/faculty', getFacultyForCourse);

// Managing the recurring rules. Faculty reach these through allowRoles;
// an admin-tier role (Admin, CR) needs the matching routine_* permission.
const canView = requirePermission('routine_view', { allowRoles: ['faculty'] });
const canCreate = requirePermission('routine_create', { allowRoles: ['faculty'] });
const canUpdate = requirePermission('routine_update', { allowRoles: ['faculty'] });
const canDelete = requirePermission('routine_delete', { allowRoles: ['faculty'] });

router.get('/templates', canView, listTemplates);
router.post('/', canCreate, createRoutine);
// Explicit alias for the spec's "create a recurring rule" call — the same
// handler, because a rule and a recurring rule are the same document here.
router.post('/recurring', canCreate, createRoutine);
router.patch('/templates/:id', canUpdate, updateTemplate);
router.delete('/templates/:id', canDelete, deleteTemplate);

router.get('/instances', canView, listInstances);
router.get('/instances/:id', getInstance);
router.patch('/instances/:id', canUpdate, updateInstance);
router.post('/instances/:id/cancel', canUpdate, cancelInstance);
router.post('/instances/:id/reschedule', canUpdate, rescheduleInstance);
router.delete('/instances/:id', canDelete, deleteInstance);

export default router;
