import { Router } from 'express';
import { body } from 'express-validator';
import { createQuestion, updateQuestion, deleteQuestion, listQuestions, getQuestion, searchQuestions, suggestQuestions } from '../controllers/questionController.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { upload } from '../middleware/upload.js';

const router = Router();

const isStaff = requirePermission('question_bank', { allowRoles: ['faculty'] });
router.use(authenticate, isStaff);

router.get('/', listQuestions);
// Registered before /:id so these literal paths aren't swallowed as an id param.
router.get('/search', searchQuestions);
router.get('/suggestions', suggestQuestions);
router.post(
  '/',
  upload.single('image'),
  [
    body('department').notEmpty().withMessage('Department is required'),
    body('course').notEmpty().withMessage('Course is required'),
    body('type').notEmpty().withMessage('Question type is required'),
    body('text').trim().notEmpty().withMessage('Question text is required'),
  ],
  validate,
  createQuestion
);
router.get('/:id', getQuestion);
router.patch('/:id', upload.single('image'), updateQuestion);
router.delete('/:id', deleteQuestion);

export default router;
