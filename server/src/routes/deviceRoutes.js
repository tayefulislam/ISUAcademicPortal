import { Router } from 'express';
import { body } from 'express-validator';
import { registerDevice, unregisterDevice, listDevices } from '../controllers/deviceController.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

// Every route here is self-service: the device is always bound to the
// authenticated user (see deviceController), never to an id from the request.
router.use(authenticate);

router.get('/', listDevices);

router.post(
  '/register',
  [body('token').isString().trim().isLength({ min: 20 }).withMessage('A valid FCM registration token is required')],
  validate,
  registerDevice
);

router.post(
  '/unregister',
  [body('token').isString().trim().isLength({ min: 20 }).withMessage('A valid FCM registration token is required')],
  validate,
  unregisterDevice
);

export default router;
