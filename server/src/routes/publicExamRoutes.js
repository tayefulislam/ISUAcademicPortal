import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  getLanding,
  verifyPassword,
  startPublicAttempt,
  getPublicAttempt,
  savePublicAnswer,
  submitPublicAttempt,
  getPublicResult,
} from '../controllers/publicExamController.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// No router-level `authenticate` — this whole router is reachable by
// guests. `optionalAuth` is applied only where capturing a logged-in
// participant's identity matters (starting/continuing an attempt); the
// landing/password endpoints don't need identity at all.
//
// Rate-limited like feedbackRoutes.js's public POST — an unauthenticated
// write endpoint is an easy target for password-guessing/spam otherwise.
const examLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later', code: 'TOO_MANY_REQUESTS' },
});

router.get('/:slug', getLanding);
router.post('/:slug/password', examLimiter, verifyPassword);
router.post('/:slug/start', examLimiter, optionalAuth, startPublicAttempt);
router.get('/:slug/attempts/:attemptId', optionalAuth, getPublicAttempt);
router.patch('/:slug/attempts/:attemptId/answer', optionalAuth, savePublicAnswer);
router.post('/:slug/attempts/:attemptId/submit', optionalAuth, submitPublicAttempt);
router.get('/:slug/attempts/:attemptId/result', optionalAuth, getPublicResult);

export default router;
