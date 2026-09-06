import { Router } from 'express';
import { body } from 'express-validator';
import { listTopics, getTopic, createTopic, updateTopic, deleteTopic } from '../controllers/topicController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

const router = Router();

router.get('/', listTopics);
router.get('/:id', getTopic);

router.post(
  '/',
  authenticate,
  requireRole('super_admin'),
  [body('name').notEmpty(), body('chapterId').notEmpty()],
  validate,
  createTopic
);
router.put('/:id', authenticate, requireRole('super_admin'), updateTopic);
router.delete('/:id', authenticate, requireRole('super_admin'), deleteTopic);

export default router;
