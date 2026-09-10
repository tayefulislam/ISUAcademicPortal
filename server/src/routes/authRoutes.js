import { Router } from 'express';
import { body } from 'express-validator';
import rateLimit from 'express-rate-limit';
import {
  register,
  login,
  me,
  changePassword,
  getPublicSettings,
  sendOtp,
  verifyOtp,
  forgotPassword,
  resetPassword,
} from '../controllers/authController.js';
import { validate } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Auth endpoints are brute-force targets, so they get a tighter limit than
// the general API rate limiter applied in app.js.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again later', code: 'TOO_MANY_REQUESTS' },
});

router.get('/settings', getPublicSettings);

router.post(
  '/register',
  authLimiter,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('department').notEmpty().withMessage('Department is required'),
    body('batch').notEmpty().withMessage('Batch is required'),
    body('semester').notEmpty().withMessage('Semester is required'),
    body('rollNo')
      .trim()
      .notEmpty()
      .withMessage('Roll No is required')
      .bail()
      .matches(/^\d{16}$/)
      .withMessage('Student ID must be exactly 16 digits'),
    body('phone')
      .trim()
      .notEmpty()
      .withMessage('Phone number is required')
      .bail()
      .matches(/^01\d{9}$/)
      .withMessage('Phone number must be exactly 11 digits and start with 01'),
  ],
  validate,
  register
);

// `identifier` accepts an email, Student ID (rollNo), or phone number — see
// authController.js's login() for the lookup logic.
router.post('/login', authLimiter, [body('identifier').trim().notEmpty().withMessage('Email, Student ID, or phone number is required'), body('password').notEmpty()], validate, login);

router.get('/me', authenticate, me);

router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty().withMessage('Current password is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
    body('confirmNewPassword').notEmpty().withMessage('Please confirm the new password'),
  ],
  validate,
  changePassword
);

router.post('/send-otp', authLimiter, [body('email').isEmail().withMessage('Valid email is required')], validate, sendOtp);

router.post(
  '/verify-otp',
  authLimiter,
  [body('email').isEmail().withMessage('Valid email is required'), body('code').trim().notEmpty().withMessage('Code is required')],
  validate,
  verifyOtp
);

router.post(
  '/forgot-password',
  authLimiter,
  [body('email').isEmail().withMessage('Valid email is required')],
  validate,
  forgotPassword
);

router.post(
  '/reset-password',
  authLimiter,
  [
    body('token').notEmpty().withMessage('Reset token is required'),
    body('newPassword').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
    body('confirmNewPassword').notEmpty().withMessage('Please confirm the new password'),
  ],
  validate,
  resetPassword
);

export default router;
