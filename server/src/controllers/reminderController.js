import crypto from 'crypto';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { getSettings } from '../models/Settings.js';
import { runDueReminders, runExamReminders } from '../services/reminderService.js';

// The cron target. This stack has no scheduler and no queue, so reminders are
// driven from outside: an external cron (Railway cron, cron-job.org, the host's
// own scheduler) POSTs here every minute.
//
// The caller is a machine, not a user, so there is no JWT to verify — the
// endpoint authenticates with a shared secret and, importantly, REFUSES to run
// at all when that secret is unset rather than defaulting to open.

function secretMatches(provided, expected) {
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(String(expected || ''));
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // expected length — compare lengths first and still run a constant-time
  // comparison so the failure path costs the same.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * POST /api/internal/reminders/run
 *
 * Safe to call as often as you like: each reminder offset is a distinct
 * notification type, so the Notification unique index rejects a duplicate and a
 * repeated run inside the same window is a no-op (spec §48).
 */
export const runReminders = asyncHandler(async (req, res) => {
  if (!env.reminderCronSecret) {
    throw new ApiError(
      503,
      'Reminders are not configured on this server (REMINDER_CRON_SECRET is unset)',
      null,
      'REMINDER_CRON_DISABLED'
    );
  }
  if (!secretMatches(req.get('x-reminder-secret'), env.reminderCronSecret)) {
    logger.warn('Rejected reminder run with a bad secret', {
      source: 'reminderController.runReminders',
      meta: { ip: req.ip },
    });
    throw new ApiError(401, 'Authentication required', null, 'UNAUTHORIZED');
  }

  // The routineSystemEnabled flag governs reminders too — its description says
  // so, and leaving this out would keep pushing "class starts in 10 minutes"
  // after an administrator had switched the whole system off.
  //
  // Answered as a 200 with a marker rather than an error: a cron running every
  // minute that starts returning 4xx would page someone. Checked AFTER the
  // secret so an unauthenticated caller learns nothing about configuration.
  const settings = await getSettings();
  if (!settings.routineSystemEnabled) {
    return res.json({
      success: true,
      data: {
        skipped: 'ROUTINE_DISABLED',
        reason: 'The class routine system is switched off',
        ranAt: new Date().toISOString(),
      },
    });
  }

  const [classReminders, examReminders] = await Promise.all([
    runDueReminders(),
    runExamReminders(),
  ]);

  res.json({
    success: true,
    data: { classReminders, examReminders, ranAt: new Date().toISOString() },
  });
});

export default { runReminders };
