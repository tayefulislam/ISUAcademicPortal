import { Router } from 'express';
import {
  createQuiz,
  updateQuiz,
  deleteQuiz,
  listMyQuizzes,
  getQuizForManage,
  listRelevantQuizzes,
  startAttempt,
  getAttempt,
  saveAnswer,
  submitAttempt,
  listMyAttempts,
  listAttemptsForQuiz,
  gradeAttempt,
  getQuizAnalytics,
} from '../controllers/quizController.js';
import { authenticate, requirePermission } from '../middleware/auth.js';

const router = Router();

const isStaff = requirePermission('quizzes', { allowRoles: ['faculty'] });

router.use(authenticate);

router.get('/mine', isStaff, listMyQuizzes);
router.get('/my-attempts', listMyAttempts);
router.get('/', listRelevantQuizzes);
router.post('/', isStaff, createQuiz);

router.get('/:id/manage', isStaff, getQuizForManage);
router.patch('/:id', isStaff, updateQuiz);
router.delete('/:id', isStaff, deleteQuiz);

router.post('/:id/start', startAttempt);
router.get('/:id/attempts/:attemptId', getAttempt);
router.patch('/:id/attempts/:attemptId/answer', saveAnswer);
router.post('/:id/attempts/:attemptId/submit', submitAttempt);

router.get('/:id/attempts', isStaff, listAttemptsForQuiz);
router.patch('/:id/attempts/:attemptId/grade', isStaff, gradeAttempt);
router.get('/:id/analytics', isStaff, getQuizAnalytics);

export default router;
