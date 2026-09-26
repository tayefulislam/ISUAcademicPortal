import rateLimit from 'express-rate-limit';
import { env } from '../../../config/env.js';
import { ApiError } from '../../../utils/ApiError.js';
import StoredFile, { STORED_FILE_ACTIVE_STATUSES } from '../../../models/StoredFile.js';

/**
 * Per-user upload throttling (§17, §25).
 *
 * Two distinct limits, because they stop two different things:
 *
 *   - requests per hour: stops a script hammering the endpoint.
 *   - CONCURRENT active uploads/jobs: stops one account from filling the
 *     processing queue (or the temp disk) with a hundred simultaneous large
 *     files, which would starve every other user's uploads. That is the §25
 *     requirement — one user must not be able to degrade the system for others.
 */

/** Keyed by the authenticated user, not the IP — a campus NAT is one IP. */
export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.uploads.rateLimit.perUserPerHour,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? String(req.user._id) : req.ip),
  message: {
    success: false,
    message: 'Too many uploads. Please wait a while and try again.',
    code: 'TOO_MANY_REQUESTS',
  },
});

/**
 * Rejects an upload when the caller already has the maximum number of uploads in
 * flight.
 *
 * Counted from the StoredFile rows themselves rather than an in-memory map, so
 * the limit holds across processes and survives a restart.
 */
export async function assertConcurrencyAllowed(ownerId) {
  const max = env.uploads.rateLimit.maxConcurrentPerUser;
  if (!max || max <= 0) return;

  const active = await StoredFile.countDocuments({
    ownerId,
    processingStatus: { $in: STORED_FILE_ACTIVE_STATUSES },
  });

  if (active >= max) {
    throw new ApiError(
      429,
      `You already have ${active} upload(s) in progress. Please wait for one to finish before starting another.`,
      { active, max },
      'TOO_MANY_UPLOADS'
    );
  }
}

export default { uploadRateLimiter, assertConcurrencyAllowed };
