import { Router } from 'express';
import { body } from 'express-validator';
import {
  createQuestion,
  updateQuestion,
  deleteQuestion,
  listQuestions,
  getQuestion,
  searchQuestions,
  suggestQuestions,
  importQuestionsFromDocx,
} from '../controllers/questionController.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { receiveUploads } from '../middleware/uploadStream.js';

const router = Router();

// A single optional image on create/update, and a single required .docx for the
// bulk import — the same streaming intake every other upload route uses.
const questionImage = receiveUploads({ fields: ['image'], maxFiles: 1, required: false });
const docxFile = receiveUploads({ fields: ['file'], maxFiles: 1 });

const isStaff = requirePermission('question_bank', { allowRoles: ['faculty'] });
router.use(authenticate, isStaff);

router.get('/', listQuestions);
// Registered before /:id so these literal paths aren't swallowed as an id param.
router.get('/search', searchQuestions);
router.get('/suggestions', suggestQuestions);
router.post('/import-docx', docxFile, importQuestionsFromDocx);
router.post(
  '/',
  questionImage,
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
router.patch('/:id', questionImage, updateQuestion);
router.delete('/:id', deleteQuestion);

export default router;
