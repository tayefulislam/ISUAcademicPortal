import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { submitFeedback } from '../controllers/feedbackController.js';
import { optionalAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Public submission, but rate-limited — an open, unauthenticated POST
// endpoint is an easy spam target otherwise.
const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many submissions, please try again later', code: 'TOO_MANY_REQUESTS' },
});

router.post(
  '/',
  feedbackLimiter,
  optionalAuth,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('category').notEmpty().withMessage('Category is required'),
    body('subject').trim().notEmpty().withMessage('Subject is required'),
    body('message').trim().notEmpty().withMessage('Message is required'),
    body('rating').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1, max: 5 }),
  ],
  validate,
  submitFeedback
);

export default router;
