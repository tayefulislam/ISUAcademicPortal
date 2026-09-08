import Quiz from '../models/Quiz.js';
import QuizAttempt from '../models/QuizAttempt.js';
import Question from '../models/Question.js';
import { getSettings } from '../models/Settings.js';
import { isAdminTierRole, isSuperAdminTier } from '../models/Role.js';
import { getEffectiveCourseIds } from '../services/courseAccessService.js';
import {
  generateAttemptSnapshot,
  hydrateAttemptForStudent,
  isExpired,
  finalizeAttempt,
  buildResultView,
  loadQuestionsById,
  marksFor,
  findUnsatisfiableRule,
} from '../services/examEngine.js';
import { buildPublicAccessUpdate } from '../services/publicExamShared.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { emit } from '../services/notifications/notificationService.js';
import { resolveCourseScopedRecipients } from '../services/notifications/recipientResolver.js';

async function resolveQuizRecipients(quiz) {
  if (!quiz.courses?.length) return [];
  const perCourse = await Promise.all(
    quiz.courses.map((course) => resolveCourseScopedRecipients({ course, batches: quiz.batches, semesters: quiz.semesters }))
  );
  return [...new Set(perCourse.flat().map(String))];
}

function notifyExamPublished(quiz, actor, type) {
  resolveQuizRecipients(quiz)
    .then((recipients) =>
      emit({
        type,
        actorId: actor._id,
        entityType: 'QUIZ',
        entityId: quiz._id,
        vars: { title: quiz.title, quizId: quiz._id, startAt: quiz.startAt ? new Date(quiz.startAt).toLocaleString() : '' },
        recipients,
      })
    )
    .catch((err) => console.error('[notify] exam publish', err));
}

const POPULATE = [
  { path: 'departments', select: 'name code' },
  { path: 'courses', select: 'name courseId' },
  { path: 'batches', select: 'name code' },
  { path: 'semesters', select: 'name code' },
  { path: 'createdBy', select: 'name role' },
];

async function assertQuizSystemEnabled() {
  const settings = await getSettings();
  if (!settings.quizSystemEnabled) throw new ApiError(400, 'The quiz system is currently disabled');
}

function parseTargeting(body) {
  return {
    departments: [].concat(body.departments || []).filter(Boolean),
    courses: [].concat(body.courses || []).filter(Boolean),
    batches: [].concat(body.batches || []).filter(Boolean),
    semesters: [].concat(body.semesters || []).filter(Boolean),
  };
}

function assertHasTarget(targeting) {
  if (!targeting.departments.length && !targeting.courses.length && !targeting.batches.length && !targeting.semesters.length) {
    throw new ApiError(400, 'Select at least one department, course, batch, or semester to target');
  }
}

function assertFacultyTargetingScope(targeting, user) {
  const deptIds = new Set((user.assignedDepartments || []).map(String));
  const courseIds = new Set((user.assignedCourses || []).map(String));
  const badDept = targeting.departments.find((d) => !deptIds.has(String(d)));
  const badCourse = targeting.courses.find((c) => !courseIds.has(String(c)));
  if (badDept || badCourse) {
    throw new ApiError(403, 'You can only target your own assigned Department(s)/Course(s)', null, 'FORBIDDEN');
  }
}

function assertManageAccess(quiz, user) {
  if (isSuperAdminTier(user.role)) return;
  if (!quiz.createdBy.equals(user._id)) {
    throw new ApiError(403, 'You can only manage quizzes you created', null, 'FORBIDDEN');
  }
}

// Handles both a raw ObjectId and an already-`.populate()`d document, so
// this stays correct even if a future call site populates `quiz` first
// (see the identical issue this fixed in assignmentController.js).
function idStr(v) {
  return String((v && v._id) || v);
}

async function userMatchesTargeting(user, quiz) {
  const deptOk = !quiz.departments?.length || quiz.departments.some((d) => idStr(d) === idStr(user.department));
  const batchOk = !quiz.batches?.length || quiz.batches.some((b) => idStr(b) === idStr(user.batch));
  const semOk = !quiz.semesters?.length || quiz.semesters.some((s) => idStr(s) === idStr(user.semester));
  let courseOk = true;
  if (quiz.courses?.length) {
    const effectiveCourseIds = await getEffectiveCourseIds(user);
    const set = new Set(effectiveCourseIds);
    courseOk = quiz.courses.some((c) => set.has(idStr(c)));
  }
  return deptOk && batchOk && semOk && courseOk;
}

async function audienceMongoFilter(user) {
  const $and = [
    { $or: [{ 'departments.0': { $exists: false } }, { departments: user.department }] },
    { $or: [{ 'batches.0': { $exists: false } }, { batches: user.batch }] },
    { $or: [{ 'semesters.0': { $exists: false } }, { semesters: user.semester }] },
  ];
  const effectiveCourseIds = await getEffectiveCourseIds(user);
  if (effectiveCourseIds.length) {
    $and.push({ $or: [{ 'courses.0': { $exists: false } }, { courses: { $in: effectiveCourseIds } }] });
  } else {
    $and.push({ 'courses.0': { $exists: false } });
  }
  return { $and };
}

async function assertQuestionsInFacultyScope(questionIds, user) {
  const deptIds = new Set((user.assignedDepartments || []).map(String));
  const courseIds = new Set((user.assignedCourses || []).map(String));
  const questions = await Question.find({ _id: { $in: questionIds } });
  if (questions.length !== questionIds.length) {
    throw new ApiError(403, 'You can only use questions from your own assigned Department/Course', null, 'FORBIDDEN');
  }
  const outOfScope = questions.find((q) => !deptIds.has(String(q.department)) && !courseIds.has(String(q.course)));
  if (outOfScope) {
    throw new ApiError(403, 'You can only use questions from your own assigned Department/Course', null, 'FORBIDDEN');
  }
  // A question owned by someone else must be marked public to be borrowed
  // into this faculty member's quiz — private ones stay creator-only.
  const notUsable = questions.find(
    (q) => !q.createdBy.equals(user._id) && q.visibility !== 'public'
  );
  if (notUsable) {
    throw new ApiError(403, 'You can only use your own questions or questions another faculty has marked public', null, 'FORBIDDEN');
  }
}

function parseQuestionList(body) {
  const raw = Array.isArray(body.questions) ? body.questions : typeof body.questions === 'string' ? JSON.parse(body.questions) : [];
  return raw.map((q, i) => ({ question: q.questionId || q.question, marks: Number(q.marks), order: q.order ?? i }));
}

// A quiz is 'random'-mode only if explicitly requested — every existing
// quiz (and any create/update that never mentions questionSelection) stays
// 'fixed', using the hand-picked `questions` list exactly as before.
function parseQuestionSelection(body) {
  const raw = body.questionSelection;
  if (!raw || raw.mode !== 'random') return { mode: 'fixed', rules: [] };
  const rulesRaw = Array.isArray(raw.rules) ? raw.rules : typeof raw.rules === 'string' ? JSON.parse(raw.rules) : [];
  const rules = rulesRaw.map((r) => ({
    course: r.course,
    difficulty: r.difficulty || 'any',
    tags: [].concat(r.tags || []).filter(Boolean).map((t) => String(t).toLowerCase().trim()),
    count: Number(r.count),
    marksEach: Number(r.marksEach),
  }));
  return { mode: 'random', rules };
}

function assertValidSelectionRules(rules) {
  if (!rules.length) throw new ApiError(400, 'Add at least one question-selection rule for a random exam');
  for (const r of rules) {
    if (!r.course) throw new ApiError(400, 'Each selection rule needs a course');
    if (!r.count || r.count < 1) throw new ApiError(400, 'Each selection rule needs a count of at least 1');
    if (r.marksEach === undefined || Number.isNaN(r.marksEach) || r.marksEach < 0) {
      throw new ApiError(400, 'Each selection rule needs a non-negative marks-per-question value');
    }
  }
}

// Resolves the question list + questionSelection for create/update: random
// mode is validated against the live bank (so a shortfall is caught here,
// not by a participant mid-exam) and needs no hand-picked `questions`;
// fixed mode is the existing behavior, unchanged.
async function resolveQuestionsAndSelection(req) {
  const questionSelection = parseQuestionSelection(req.body);
  if (questionSelection.mode === 'random') {
    assertValidSelectionRules(questionSelection.rules);
    const unsatisfiable = await findUnsatisfiableRule(questionSelection.rules);
    if (unsatisfiable) {
      throw new ApiError(
        400,
        `Not enough questions available for one of your selection rules (need ${unsatisfiable.rule.count}, found ${unsatisfiable.available})`
      );
    }
    return { questions: [], questionSelection };
  }

  const questions = parseQuestionList(req.body);
  if (!questions.length) throw new ApiError(400, 'A quiz needs at least one question');
  if (req.user.role === 'faculty') await assertQuestionsInFacultyScope(questions.map((q) => q.question), req.user);
  return { questions, questionSelection };
}

// ----- CRUD -----

export const createQuiz = asyncHandler(async (req, res) => {
  await assertQuizSystemEnabled();
  const { title, description, startAt, endAt, duration, passingMarks, attemptsAllowed } = req.body;
  if (!startAt || !endAt || !duration) throw new ApiError(400, 'startAt, endAt, and duration are required');
  if (new Date(endAt) <= new Date(startAt)) throw new ApiError(400, 'endAt must be after startAt');

  const isPublic = req.body.examType === 'public';

  // Public exams reach participants via their shareable URL, not
  // department/course/batch/semester targeting — that's meaningless for an
  // anonymous guest, so it's the one requirement skipped in this mode.
  let targeting = { departments: [], courses: [], batches: [], semesters: [] };
  if (!isPublic) {
    targeting = parseTargeting(req.body);
    assertHasTarget(targeting);
    if (req.user.role === 'faculty') assertFacultyTargetingScope(targeting, req.user);
  }

  const { questions, questionSelection } = await resolveQuestionsAndSelection(req);

  const { examType, publicAccess } = await buildPublicAccessUpdate(req.body, null);

  const quiz = await Quiz.create({
    title,
    description: description || '',
    ...targeting,
    questions,
    questionSelection,
    startAt,
    endAt,
    duration: Number(duration),
    passingMarks: passingMarks ? Number(passingMarks) : 0,
    attemptsAllowed: attemptsAllowed ? Number(attemptsAllowed) : 1,
    randomizeQuestions: !!req.body.randomizeQuestions,
    randomizeOptions: !!req.body.randomizeOptions,
    showResultImmediately: req.body.showResultImmediately !== false,
    showCorrectAnswers: !!req.body.showCorrectAnswers,
    negativeMarking: {
      enabled: !!req.body.negativeMarking?.enabled,
      valuePerWrong: Number(req.body.negativeMarking?.valuePerWrong) || 0,
    },
    status: req.body.status === 'published' ? 'published' : 'draft',
    createdBy: req.user._id,
    examType,
    publicAccess,
  });

  // A freshly-created in-memory document still carries `select:false`
  // fields (that only excludes them from *queries*), so the password hash
  // must be stripped by hand before this response leaves the server.
  if (quiz.status === 'published') notifyExamPublished(quiz, req.user, 'EXAM_CREATED');

  const safeQuiz = quiz.toObject();
  if (safeQuiz.publicAccess) delete safeQuiz.publicAccess.passwordHash;
  res.status(201).json({ success: true, data: safeQuiz });
});

export const updateQuiz = asyncHandler(async (req, res) => {
  // `+publicAccess.passwordHash` is needed here so buildPublicAccessUpdate
  // can keep the existing hash when the Faculty doesn't send a new
  // password — it is stripped by hand from the response below, same as
  // createQuiz, so it never actually leaves the server.
  const quiz = await Quiz.findById(req.params.id).select('+publicAccess.passwordHash');
  if (!quiz) throw new ApiError(404, 'Quiz not found');
  assertManageAccess(quiz, req.user);
  const wasPublished = quiz.status === 'published';

  const nextMode = req.body.questionSelection !== undefined ? req.body.questionSelection.mode || 'fixed' : quiz.questionSelection?.mode || 'fixed';

  if (req.body.questions !== undefined && nextMode === 'fixed') {
    const incoming = parseQuestionList(req.body);
    const changed =
      incoming.length !== quiz.questions.length ||
      incoming.some((q, i) => {
        const existing = quiz.questions[i];
        return !existing || String(q.question) !== String(existing.question) || q.marks !== existing.marks;
      });
    if (changed) {
      const attemptCount = await QuizAttempt.countDocuments({ quiz: quiz._id });
      if (attemptCount > 0) throw new ApiError(409, 'Cannot change questions after students have started attempting this quiz');
    }
  }

  const scalar = ['title', 'description', 'startAt', 'endAt', 'passingMarks', 'attemptsAllowed', 'status'];
  for (const key of scalar) {
    if (req.body[key] !== undefined) quiz[key] = req.body[key];
  }
  if (req.body.duration !== undefined) quiz.duration = Number(req.body.duration);
  if (req.body.randomizeQuestions !== undefined) quiz.randomizeQuestions = !!req.body.randomizeQuestions;
  if (req.body.randomizeOptions !== undefined) quiz.randomizeOptions = !!req.body.randomizeOptions;
  if (req.body.showResultImmediately !== undefined) quiz.showResultImmediately = !!req.body.showResultImmediately;
  if (req.body.showCorrectAnswers !== undefined) quiz.showCorrectAnswers = !!req.body.showCorrectAnswers;
  if (req.body.negativeMarking !== undefined) {
    quiz.negativeMarking = {
      enabled: !!req.body.negativeMarking.enabled,
      valuePerWrong: Number(req.body.negativeMarking.valuePerWrong) || 0,
    };
  }

  const nextExamType = req.body.examType !== undefined ? req.body.examType : quiz.examType;
  if (nextExamType !== 'public' && (req.body.departments || req.body.courses || req.body.batches || req.body.semesters)) {
    const targeting = parseTargeting(req.body);
    assertHasTarget(targeting);
    if (req.user.role === 'faculty') assertFacultyTargetingScope(targeting, req.user);
    Object.assign(quiz, targeting);
  }

  if (req.body.examType !== undefined || req.body.publicAccess !== undefined) {
    // A patch that only sends `publicAccess` (e.g. the Disable toggle)
    // must not be misread as "examType: course" — default to the quiz's
    // current type when the caller doesn't explicitly change it.
    const { examType, publicAccess } = await buildPublicAccessUpdate({ ...req.body, examType: nextExamType }, quiz);
    quiz.examType = examType;
    quiz.publicAccess = publicAccess;
    // Switching into public mode drops any existing course/batch/etc.
    // targeting — it's meaningless once the exam is reachable by anyone
    // with the link.
    if (examType === 'public') Object.assign(quiz, { departments: [], courses: [], batches: [], semesters: [] });
  }

  if (req.body.questionSelection !== undefined) {
    const questionSelection = parseQuestionSelection(req.body);
    if (questionSelection.mode === 'random') {
      assertValidSelectionRules(questionSelection.rules);
      const unsatisfiable = await findUnsatisfiableRule(questionSelection.rules);
      if (unsatisfiable) {
        throw new ApiError(
          400,
          `Not enough questions available for one of your selection rules (need ${unsatisfiable.rule.count}, found ${unsatisfiable.available})`
        );
      }
      quiz.questions = []; // the fixed list is meaningless once random selection is on
    }
    quiz.questionSelection = questionSelection;
  }

  if (req.body.questions !== undefined && nextMode === 'fixed') {
    const questions = parseQuestionList(req.body);
    if (!questions.length) throw new ApiError(400, 'A quiz needs at least one question');
    if (req.user.role === 'faculty') await assertQuestionsInFacultyScope(questions.map((q) => q.question), req.user);
    quiz.questions = questions;
  }

  await quiz.save();

  if (!wasPublished && quiz.status === 'published') notifyExamPublished(quiz, req.user, 'EXAM_CREATED');
  else if (wasPublished && quiz.status === 'published') notifyExamPublished(quiz, req.user, 'EXAM_UPDATED');

  const safeQuiz = quiz.toObject();
  if (safeQuiz.publicAccess) delete safeQuiz.publicAccess.passwordHash;
  res.json({ success: true, data: safeQuiz });
});

export const deleteQuiz = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) throw new ApiError(404, 'Quiz not found');
  assertManageAccess(quiz, req.user);

  await QuizAttempt.deleteMany({ quiz: quiz._id });
  await quiz.deleteOne();

  res.json({ success: true, message: 'Quiz deleted' });
});

export const listMyQuizzes = asyncHandler(async (req, res) => {
  const filter = isSuperAdminTier(req.user.role) ? {} : { createdBy: req.user._id };
  const quizzes = await Quiz.find(filter)
    .populate(POPULATE)
    .populate({ path: 'questions.question', select: 'type text' })
    .sort({ createdAt: -1 });
  res.json({ success: true, data: quizzes });
});

// GET /quizzes/:id/manage — full quiz including questions + correct answers,
// for the creator/super_admin to edit.
export const getQuizForManage = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id).populate(POPULATE).populate({ path: 'questions.question' });
  if (!quiz) throw new ApiError(404, 'Quiz not found');
  assertManageAccess(quiz, req.user);
  res.json({ success: true, data: quiz });
});

// GET /quizzes — audience view: published quizzes relevant to the viewer,
// metadata only (no questions/answers).
export const listRelevantQuizzes = asyncHandler(async (req, res) => {
  await assertQuizSystemEnabled();
  let filter = { status: { $in: ['published', 'closed'] } };
  if (!isSuperAdminTier(req.user.role) && !(await isAdminTierRole(req.user.role))) {
    filter = { ...filter, ...(await audienceMongoFilter(req.user)) };
  }

  const quizzes = await Quiz.find(filter).populate(POPULATE).select('-questions').sort({ startAt: -1 });
  const attempts = await QuizAttempt.find({ quiz: { $in: quizzes.map((q) => q._id) }, student: req.user._id });
  const byQuiz = new Map();
  for (const a of attempts) {
    const list = byQuiz.get(String(a.quiz)) || [];
    list.push(a);
    byQuiz.set(String(a.quiz), list);
  }

  res.json({
    success: true,
    data: quizzes.map((q) => ({
      ...q.toObject(),
      questionCount: undefined,
      myAttempts: (byQuiz.get(String(q._id)) || []).map((a) => ({
        _id: a._id,
        attemptNumber: a.attemptNumber,
        status: a.status,
        totalScore: a.status === 'graded' && q.showResultImmediately ? a.totalScore : null,
        submittedAt: a.submittedAt,
      })),
    })),
  });
});

// POST /quizzes/:id/start — resumes an in-progress attempt if one exists,
// otherwise starts a new one (enforcing the attempt limit + time window +
// targeting, all server-side).
export const startAttempt = asyncHandler(async (req, res) => {
  await assertQuizSystemEnabled();
  const quiz = await Quiz.findById(req.params.id).populate({ path: 'questions.question' });
  if (!quiz) throw new ApiError(404, 'Quiz not found');
  if (quiz.status !== 'published') throw new ApiError(400, 'This quiz is not available');

  const now = new Date();
  if (now < quiz.startAt) throw new ApiError(400, 'This quiz has not started yet');
  if (now > quiz.endAt) throw new ApiError(400, 'This quiz window has closed');

  const isManager = isSuperAdminTier(req.user.role) || quiz.createdBy.equals(req.user._id);
  if (!isManager && !(await isAdminTierRole(req.user.role)) && !(await userMatchesTargeting(req.user, quiz))) {
    throw new ApiError(403, 'This quiz is not targeted to you', null, 'FORBIDDEN');
  }

  const existing = await QuizAttempt.findOne({ quiz: quiz._id, student: req.user._id, status: 'in_progress' });
  if (existing) {
    return res.json({ success: true, data: await hydrateAttemptForStudent(existing, quiz) });
  }

  const attemptCount = await QuizAttempt.countDocuments({ quiz: quiz._id, student: req.user._id });
  if (attemptCount >= quiz.attemptsAllowed) {
    throw new ApiError(409, 'You have no attempts remaining for this quiz');
  }

  const { questionOrder, optionOrder, assignedMarks } = await generateAttemptSnapshot(quiz);

  const attempt = await QuizAttempt.create({
    quiz: quiz._id,
    student: req.user._id,
    attemptNumber: attemptCount + 1,
    questionOrder,
    optionOrder,
    assignedMarks,
    answers: [],
  });

  res.status(201).json({ success: true, data: await hydrateAttemptForStudent(attempt, quiz) });
});

async function loadOwnedAttempt(quizId, attemptId, user) {
  const attempt = await QuizAttempt.findById(attemptId);
  if (!attempt || String(attempt.quiz) !== String(quizId)) throw new ApiError(404, 'Attempt not found');
  const isOwner = attempt.student && attempt.student.equals(user._id);
  const quiz = await Quiz.findById(quizId).populate({ path: 'questions.question' });
  if (!quiz) throw new ApiError(404, 'Quiz not found');
  const isManager = isSuperAdminTier(user.role) || quiz.createdBy.equals(user._id);
  if (!isOwner && !isManager) throw new ApiError(403, 'Not your attempt', null, 'FORBIDDEN');
  return { attempt, quiz, isOwner, isManager };
}

export const getAttempt = asyncHandler(async (req, res) => {
  const { attempt, quiz, isOwner, isManager } = await loadOwnedAttempt(req.params.id, req.params.attemptId, req.user);

  if (isOwner && attempt.status === 'in_progress') {
    if (isExpired(attempt, quiz)) {
      await finalizeAttempt(attempt, quiz);
    } else {
      return res.json({ success: true, data: await hydrateAttemptForStudent(attempt, quiz) });
    }
  }

  res.json({ success: true, data: await buildResultView(attempt, quiz, isManager) });
});

// PATCH /quizzes/:id/attempts/:attemptId/answer — continuous autosave.
export const saveAnswer = asyncHandler(async (req, res) => {
  const { attempt, quiz, isOwner } = await loadOwnedAttempt(req.params.id, req.params.attemptId, req.user);
  if (!isOwner) throw new ApiError(403, 'Not your attempt', null, 'FORBIDDEN');
  if (attempt.status !== 'in_progress') throw new ApiError(409, 'This attempt has already been submitted');

  if (isExpired(attempt, quiz)) {
    await finalizeAttempt(attempt, quiz);
    return res.status(409).json({ success: false, message: 'Time is up — this attempt was auto-submitted', autoSubmitted: true });
  }

  const { questionId, selectedOptionIds, textAnswers, numericalAnswer, matchingAnswer, markedForReview } = req.body;
  if (!questionId) throw new ApiError(400, 'questionId is required');

  const idx = attempt.answers.findIndex((a) => String(a.question) === String(questionId));
  const entry = {
    question: questionId,
    selectedOptionIds: selectedOptionIds || [],
    textAnswers: textAnswers || [],
    numericalAnswer: numericalAnswer === undefined || numericalAnswer === '' ? null : Number(numericalAnswer),
    matchingAnswer: matchingAnswer || [],
    markedForReview: !!markedForReview,
    marksAwarded: null,
    isCorrect: null,
  };
  if (idx >= 0) attempt.answers[idx] = { ...attempt.answers[idx].toObject(), ...entry };
  else attempt.answers.push(entry);

  await attempt.save();
  res.json({ success: true, message: 'Saved' });
});

export const submitAttempt = asyncHandler(async (req, res) => {
  const { attempt, quiz, isOwner, isManager } = await loadOwnedAttempt(req.params.id, req.params.attemptId, req.user);
  if (!isOwner) throw new ApiError(403, 'Not your attempt', null, 'FORBIDDEN');

  if (attempt.status === 'in_progress') {
    await finalizeAttempt(attempt, quiz);
  }

  res.json({ success: true, data: await buildResultView(attempt, quiz, isManager) });
});

export const listMyAttempts = asyncHandler(async (req, res) => {
  const attempts = await QuizAttempt.find({ student: req.user._id })
    .populate({ path: 'quiz', select: 'title totalMarks passingMarks showResultImmediately' })
    .sort({ createdAt: -1 });
  res.json({ success: true, data: attempts });
});

export const listAttemptsForQuiz = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id);
  if (!quiz) throw new ApiError(404, 'Quiz not found');
  assertManageAccess(quiz, req.user);

  const attempts = await QuizAttempt.find({ quiz: quiz._id })
    .populate({ path: 'student', select: 'name email rollNo department batch', populate: [{ path: 'department', select: 'code' }, { path: 'batch', select: 'name' }] })
    .sort({ createdAt: -1 });

  res.json({ success: true, data: attempts });
});

// PATCH /quizzes/:id/attempts/:attemptId/grade — manual grading for
// long_answer questions: body { grades: [{ questionId, marksAwarded }] }.
export const gradeAttempt = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id).populate({ path: 'questions.question' });
  if (!quiz) throw new ApiError(404, 'Quiz not found');
  assertManageAccess(quiz, req.user);

  const attempt = await QuizAttempt.findById(req.params.attemptId);
  if (!attempt || String(attempt.quiz) !== String(quiz._id)) throw new ApiError(404, 'Attempt not found');

  // Resolved from the attempt's own snapshot, not `quiz.questions` — a
  // random-selection exam's attempt may hold questions never listed there.
  const questionsById = await loadQuestionsById(attempt);

  const grades = req.body.grades || [];
  for (const g of grades) {
    const maxMarks = marksFor(attempt, quiz, g.questionId);
    if (Number(g.marksAwarded) > maxMarks) throw new ApiError(400, `marksAwarded cannot exceed ${maxMarks} for this question`);
    const idx = attempt.answers.findIndex((a) => String(a.question) === String(g.questionId));
    if (idx >= 0) attempt.answers[idx].marksAwarded = Number(g.marksAwarded);
  }

  const stillUngraded = attempt.answers.some((a) => {
    const q = questionsById.get(String(a.question));
    return q?.type === 'long_answer' && (a.marksAwarded === null || a.marksAwarded === undefined);
  });

  attempt.manualScore = attempt.answers
    .filter((a) => questionsById.get(String(a.question))?.type === 'long_answer')
    .reduce((sum, a) => sum + (a.marksAwarded || 0), 0);

  attempt.needsManualGrading = stillUngraded;
  if (!stillUngraded) {
    attempt.totalScore = attempt.autoScore + attempt.manualScore;
    attempt.status = 'graded';
    attempt.gradedBy = req.user._id;
    attempt.gradedAt = new Date();
  }

  await attempt.save();

  if (!stillUngraded && attempt.student) {
    emit({
      type: 'EXAM_RESULT',
      actorId: req.user._id,
      entityType: 'QUIZ_ATTEMPT',
      entityId: attempt._id,
      vars: { title: quiz.title, attemptId: attempt._id },
      recipients: [attempt.student],
    }).catch((err) => console.error('[notify] manual grade attempt', err));
  }

  res.json({ success: true, data: attempt });
});

// GET /quizzes/:id/analytics — question-wise stats + overall performance.
export const getQuizAnalytics = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findById(req.params.id).populate({ path: 'questions.question' });
  if (!quiz) throw new ApiError(404, 'Quiz not found');
  assertManageAccess(quiz, req.user);

  const attempts = await QuizAttempt.find({ quiz: quiz._id, status: { $in: ['submitted', 'graded'] } });
  const graded = attempts.filter((a) => a.status === 'graded' && a.totalScore !== null);

  // Built from the union of every attempt's own question snapshot, not
  // `quiz.questions` — a random-selection exam's attempts don't all share
  // the same question set, so that list wouldn't be complete or accurate.
  const allQuestionIds = new Set();
  for (const attempt of attempts) for (const qid of attempt.questionOrder) allQuestionIds.add(String(qid));
  const questionDocs = await Question.find({ _id: { $in: [...allQuestionIds] } });
  const questionDocsById = new Map(questionDocs.map((q) => [String(q._id), q]));

  const questionStats = [...allQuestionIds].map((qid) => {
    const question = questionDocsById.get(qid);
    let correct = 0;
    let incorrect = 0;
    let unanswered = 0;
    let marks = 0;
    for (const attempt of attempts) {
      if (!attempt.questionOrder.some((id) => String(id) === qid)) continue;
      marks = marksFor(attempt, quiz, qid);
      const answer = attempt.answers.find((a) => String(a.question) === qid);
      const wasAnswered =
        answer && (answer.selectedOptionIds?.length || answer.textAnswers?.some(Boolean) || answer.numericalAnswer !== null || answer.matchingAnswer?.length);
      if (!wasAnswered) unanswered += 1;
      else if (answer.isCorrect) correct += 1;
      else if (answer.isCorrect === false) incorrect += 1;
    }
    return { questionId: qid, text: question?.text, type: question?.type, marks, correct, incorrect, unanswered };
  });

  const allAttempts = quiz.examType === 'public' ? await QuizAttempt.find({ quiz: quiz._id }) : [];

  res.json({
    success: true,
    data: {
      totalAttempts: attempts.length,
      gradedAttempts: graded.length,
      averageScore: graded.length ? Math.round((graded.reduce((s, a) => s + a.totalScore, 0) / graded.length) * 100) / 100 : null,
      passCount: graded.filter((a) => a.totalScore >= quiz.passingMarks).length,
      questionStats,
      // Public-exam-only breakdown — guest vs logged-in participation.
      ...(quiz.examType === 'public'
        ? {
            totalParticipants: allAttempts.length,
            guestParticipants: allAttempts.filter((a) => a.isGuestAttempt).length,
            loggedInParticipants: allAttempts.filter((a) => !a.isGuestAttempt).length,
            completedAttempts: allAttempts.filter((a) => a.status !== 'in_progress').length,
          }
        : {}),
    },
  });
});
