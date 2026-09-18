import { Router } from 'express';
import { runReminders } from '../controllers/reminderController.js';

// Deliberately NOT behind `authenticate`: the caller is an external cron, not a
// user. It authenticates with the REMINDER_CRON_SECRET header instead, and
// refuses to run at all when that secret is unset (see reminderController).
const router = Router();

router.post('/run', runReminders);

export default router;
