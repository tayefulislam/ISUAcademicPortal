// The shared Attempt/Grading/Result engine used by BOTH authenticated
// course quizzes (quizController.js) and public/guest exams
// (publicExamController.js). Extracted verbatim from quizController.js so
// "COURSE EXAM + PUBLIC EXAM share the same engine" is an actual shared
// module both controllers import, not just a design intention — moving
// these functions here changes nothing about how they behave.
//
// Every question/marks lookup below is attempt-centric (resolved from
// `attempt.questionOrder`/`attempt.assignedMarks`, never from
// `quiz.questions` at read time) — this is what lets a random-selection
// exam's per-attempt question set be graded/displayed exactly like a
// fixed-list exam's, and what guarantees a later Question Bank edit or
// quiz edit can never change an already-taken attempt's questions or marks.
import Question from '../models/Question.js';
import { emit } from './notifications/notificationService.js';

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Resolves the actual Question documents for an attempt's snapshot —
// works identically whether those questions came from the quiz's fixed
// list or were randomly sampled at start time, since either way their ids
// live in `attempt.questionOrder`.
export async function loadQuestionsById(attempt) {
  const questions = await Question.find({ _id: { $in: attempt.questionOrder } });
  return new Map(questions.map((q) => [String(q._id), q]));
}

// Marks assigned to `questionId` for THIS attempt. Falls back to the
// quiz's fixed `questions[].marks` list for attempts created before
// `assignedMarks` existed (every attempt going forward has it, for both
// fixed and random-selection exams).
export function marksFor(attempt, quiz, questionId) {
  const fromAttempt = attempt.assignedMarks?.get(String(questionId));
  if (fromAttempt !== undefined) return fromAttempt;
  return quiz.questions.find((q) => String(q.question._id || q.question) === String(questionId))?.marks ?? 0;
}

// Strips every correct-answer field from a question — used whenever a
// participant is looking at live questions (starting/resuming an attempt).
// `marks` is the assigned marks for THIS attempt (see marksFor) — not the
// Question bank's own `defaultMarks`, which a quiz may override.
export function sanitizeQuestionForAttempt(question, optionOrder, marks) {
  const q = question.toObject ? question.toObject() : question;
  let options = (q.options || []).map((o) => ({ _id: o._id, text: o.text, imageUrl: o.imageUrl }));
  if (optionOrder?.length) {
    const byId = new Map(options.map((o) => [String(o._id), o]));
    options = optionOrder.map((id) => byId.get(String(id))).filter(Boolean);
  }
  return {
    _id: q._id,
    type: q.type,
    text: q.text,
    imageUrl: q.imageUrl,
    options,
    // Matching needs the left-hand items to match against — only the right
    // (correct) side is a secret, so that's the only side withheld here.
    matchingLeft: q.type === 'matching' ? (q.matchingPairs || []).map((p) => p.left) : undefined,
    marks,
  };
}

function buildRuleFilter(rule) {
  const filter = { course: rule.course, status: 'active' };
  if (rule.difficulty && rule.difficulty !== 'any') filter.difficulty = rule.difficulty;
  if (rule.tags?.length) filter.tags = { $in: rule.tags };
  return filter;
}

// Checks every rule in a random-selection quiz has enough matching bank
// questions — called at quiz create/update time so Faculty see a shortfall
// immediately, not a participant mid-exam. Returns the first problem found,
// or null if every rule is satisfiable.
export async function findUnsatisfiableRule(rules) {
  for (const rule of rules) {
    // eslint-disable-next-line no-await-in-loop
    const available = await Question.countDocuments(buildRuleFilter(rule));
    if (available < rule.count) {
      return { rule, available };
    }
  }
  return null;
}

// Generates the question-order (+ option-order, if randomizeOptions, +
// assignedMarks) snapshot once at attempt-start — stored on the attempt so
// a refresh/resume never re-shuffles and a later exam/bank edit never
// touches it. Shared by the authenticated startAttempt and the public
// startAttempt.
export async function generateAttemptSnapshot(quiz) {
  const assignedMarks = new Map();
  let orderedIds;

  if (quiz.questionSelection?.mode === 'random') {
    const rules = quiz.questionSelection.rules || [];
    const picked = [];
    for (const rule of rules) {
      // eslint-disable-next-line no-await-in-loop
      const pool = await Question.find(buildRuleFilter(rule)).select('_id');
      if (pool.length < rule.count) {
        // Defensive re-check — the primary validation happens at quiz
        // create/update time (server/src/controllers/quizController.js),
        // but the bank can shrink between then and a participant starting.
        throw new Error(`Not enough questions available for one of this exam's selection rules (need ${rule.count}, found ${pool.length})`);
      }
      const chosen = shuffle(pool.map((p) => p._id)).slice(0, rule.count);
      for (const id of chosen) assignedMarks.set(String(id), rule.marksEach);
      picked.push(...chosen);
    }
    orderedIds = quiz.randomizeQuestions ? shuffle(picked) : picked;
  } else {
    orderedIds = quiz.questions.slice().sort((a, b) => a.order - b.order).map((q) => q.question._id);
    for (const q of quiz.questions) assignedMarks.set(String(q.question._id), q.marks);
    if (quiz.randomizeQuestions) orderedIds = shuffle(orderedIds);
  }

  let optionOrder;
  if (quiz.randomizeOptions) {
    const questionDocs =
      quiz.questionSelection?.mode === 'random' ? await Question.find({ _id: { $in: orderedIds } }) : quiz.questions.map((q) => q.question);
    const byId = new Map(questionDocs.map((q) => [String(q._id), q]));
    optionOrder = new Map();
    for (const id of orderedIds) {
      const q = byId.get(String(id));
      if (q && ['mcq', 'multi_select', 'true_false'].includes(q.type)) {
        optionOrder.set(String(id), shuffle(q.options.map((o) => o._id)));
      }
    }
  }

  return { questionOrder: orderedIds, optionOrder, assignedMarks };
}

export async function hydrateAttemptForStudent(attempt, quiz) {
  const questionsById = await loadQuestionsById(attempt);
  const questions = attempt.questionOrder.map((id) =>
    sanitizeQuestionForAttempt(questionsById.get(String(id)), attempt.optionOrder?.get(String(id)), marksFor(attempt, quiz, id))
  );
  return {
    _id: attempt._id,
    quiz: quiz._id,
    attemptNumber: attempt.attemptNumber,
    startedAt: attempt.startedAt,
    durationMinutes: quiz.duration,
    deadlineAt: new Date(attempt.startedAt.getTime() + quiz.duration * 60000),
    status: attempt.status,
    questions,
    answers: attempt.answers,
  };
}

export function isExpired(attempt, quiz) {
  return Date.now() > new Date(attempt.startedAt).getTime() + quiz.duration * 60000;
}

function normalize(str) {
  return String(str || '').trim().toLowerCase();
}

export function gradeAnswer(question, answer, marks, negativeMarking) {
  let isCorrect = false;

  switch (question.type) {
    case 'mcq':
    case 'true_false': {
      const correctId = question.options.find((o) => o.isCorrect)?._id;
      isCorrect = answer.selectedOptionIds.length === 1 && String(answer.selectedOptionIds[0]) === String(correctId);
      break;
    }
    case 'multi_select': {
      const correctIds = new Set(question.options.filter((o) => o.isCorrect).map((o) => String(o._id)));
      const givenIds = new Set(answer.selectedOptionIds.map(String));
      isCorrect = correctIds.size === givenIds.size && [...correctIds].every((id) => givenIds.has(id));
      break;
    }
    case 'numerical': {
      if (answer.numericalAnswer !== null && answer.numericalAnswer !== undefined) {
        isCorrect = Math.abs(answer.numericalAnswer - question.numericalAnswer) <= (question.numericalTolerance || 0);
      }
      break;
    }
    case 'short_answer':
    case 'fill_blank': {
      const given = answer.textAnswers || [];
      if (question.type === 'short_answer') {
        isCorrect = given.length > 0 && question.correctTextAnswers.some((c) => normalize(c) === normalize(given[0]));
      } else {
        isCorrect =
          given.length === question.correctTextAnswers.length &&
          question.correctTextAnswers.every((c, i) => normalize(c) === normalize(given[i]));
      }
      break;
    }
    case 'matching': {
      const given = answer.matchingAnswer || [];
      const total = question.matchingPairs.length;
      if (total > 0) {
        const correctCount = question.matchingPairs.filter((p) =>
          given.some((g) => normalize(g.left) === normalize(p.left) && normalize(g.right) === normalize(p.right))
        ).length;
        const fraction = correctCount / total;
        isCorrect = fraction === 1;
        const partialMarks = Math.round(marks * fraction * 100) / 100;
        return { isCorrect, marksAwarded: partialMarks };
      }
      break;
    }
    default:
      break;
  }

  const answered =
    answer.selectedOptionIds?.length || answer.textAnswers?.some(Boolean) || answer.numericalAnswer !== null || answer.matchingAnswer?.length;

  let marksAwarded = 0;
  if (isCorrect) marksAwarded = marks;
  else if (answered && negativeMarking?.enabled) {
    // A per-question override (Question.negativeMarks > 0) takes priority
    // over the quiz's flat value — lets Faculty penalize harder questions
    // more without changing the quiz-wide default for every question.
    marksAwarded = -(question.negativeMarks > 0 ? question.negativeMarks : negativeMarking.valuePerWrong);
  }

  return { isCorrect, marksAwarded };
}

// Auto-grades every answer against its Question, applies negative marking,
// and decides whether the attempt still needs a human grade (long_answer).
// Mutates + saves `attempt`, returns it. Identical for course quizzes and
// public exams, and for fixed or randomly-selected question sets — grading
// never depends on how the participant got here or which questions they got.
export async function finalizeAttempt(attempt, quiz) {
  const questionsById = await loadQuestionsById(attempt);
  let autoScore = 0;
  let needsManualGrading = false;

  const answers = attempt.questionOrder.map((qid) => {
    const question = questionsById.get(String(qid));
    const marks = marksFor(attempt, quiz, qid);
    const existing = attempt.answers.find((a) => String(a.question) === String(qid));
    const base = existing
      ? existing.toObject()
      : { question: qid, selectedOptionIds: [], textAnswers: [], numericalAnswer: null, matchingAnswer: [], markedForReview: false };

    if (question.type === 'long_answer') {
      needsManualGrading = true;
      return { ...base, marksAwarded: null, isCorrect: null };
    }

    const { isCorrect, marksAwarded } = gradeAnswer(question, base, marks, quiz.negativeMarking);
    autoScore += marksAwarded;
    return { ...base, isCorrect, marksAwarded };
  });

  attempt.answers = answers;
  attempt.autoScore = Math.max(0, autoScore);
  attempt.needsManualGrading = needsManualGrading;
  attempt.submittedAt = new Date();
  attempt.status = needsManualGrading ? 'submitted' : 'graded';
  if (!needsManualGrading) {
    attempt.manualScore = 0;
    attempt.totalScore = attempt.autoScore;
    attempt.gradedAt = new Date();
  }
  await attempt.save();

  // System-actor event (no `req.user` here — this runs on autosubmit/expiry
  // as well as a normal submit) — skip guest/studentless public-exam
  // attempts, and skip when manual grading is still pending (no result yet).
  if (!needsManualGrading && attempt.student) {
    emit({
      type: 'EXAM_RESULT',
      actorId: null,
      entityType: 'QUIZ_ATTEMPT',
      entityId: attempt._id,
      vars: { title: quiz.title, attemptId: attempt._id },
      recipients: [attempt.student],
    }).catch((err) => console.error('[notify] auto-grade attempt', err));
  }

  return attempt;
}

// Shapes the response for a submitted/graded course-quiz attempt according
// to the quiz's showResultImmediately / showCorrectAnswers flags — staff
// always see everything. Public exams use `buildPublicResultView` below
// instead, since their result-visibility rules are richer (visibility mode
// + 6 independent flags) — both draw from the exact same `attempt`/`quiz`
// data this function reads.
export async function buildResultView(attempt, quiz, isManager) {
  const revealScore = isManager || quiz.showResultImmediately;
  const revealAnswers = isManager || quiz.showCorrectAnswers;

  const questionsById = await loadQuestionsById(attempt);

  return {
    _id: attempt._id,
    quiz: quiz._id,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    totalMarks: quiz.totalMarks,
    autoScore: revealScore ? attempt.autoScore : undefined,
    manualScore: revealScore ? attempt.manualScore : undefined,
    totalScore: revealScore ? attempt.totalScore : undefined,
    needsManualGrading: attempt.needsManualGrading,
    passed: revealScore && attempt.totalScore !== null ? attempt.totalScore >= quiz.passingMarks : undefined,
    answers: attempt.answers.map((a) => {
      const q = questionsById.get(String(a.question));
      return {
        question: a.question,
        questionText: q?.text,
        questionType: q?.type,
        selectedOptionIds: a.selectedOptionIds,
        textAnswers: a.textAnswers,
        numericalAnswer: a.numericalAnswer,
        matchingAnswer: a.matchingAnswer,
        marksAwarded: revealScore ? a.marksAwarded : undefined,
        isCorrect: revealScore ? a.isCorrect : undefined,
        // The full option list (with text) is needed alongside the bare
        // correct-option ids — without it the client has no way to render
        // *what* the correct answer actually was, only that some id was
        // correct.
        options: revealAnswers ? q?.options?.map((o) => ({ _id: o._id, text: o.text })) : undefined,
        correctOptionIds: revealAnswers ? q?.options?.filter((o) => o.isCorrect).map((o) => o._id) : undefined,
        correctTextAnswers: revealAnswers ? q?.correctTextAnswers : undefined,
        correctMatchingPairs: revealAnswers ? q?.matchingPairs : undefined,
        correctNumericalAnswer: revealAnswers ? q?.numericalAnswer : undefined,
        explanation: revealAnswers ? q?.explanation : undefined,
      };
    }),
  };
}

// Public-exam result view — same underlying attempt/quiz data as
// buildResultView above (same grading engine, same `attempt.answers`), but
// driven by `publicAccess.resultSettings`'s visibility mode + 6
// independently-configurable flags instead of the simpler course-quiz pair.
// `isManager` (the exam's own Faculty/Admin) always sees everything.
export async function buildPublicResultView(attempt, quiz, isManager) {
  const rs = quiz.publicAccess?.resultSettings || {};

  if (!isManager) {
    if (rs.visibility === 'hidden') {
      return { _id: attempt._id, status: attempt.status, resultState: 'hidden' };
    }
    if (rs.visibility === 'after_grading' && attempt.needsManualGrading) {
      return { _id: attempt._id, status: attempt.status, resultState: 'pending_grading' };
    }
    if (rs.visibility === 'scheduled' && (!rs.scheduledAt || Date.now() < new Date(rs.scheduledAt).getTime())) {
      return { _id: attempt._id, status: attempt.status, resultState: 'scheduled', availableAt: rs.scheduledAt };
    }
  }

  const showScore = isManager || rs.showScore !== false;
  const showPercentage = isManager || rs.showPercentage !== false;
  const showPassFail = isManager || rs.showPassFail !== false;
  const showCorrectAnswers = isManager || !!rs.showCorrectAnswers;
  const showExplanations = isManager || !!rs.showExplanations;
  const showQuestionByQuestion = isManager || rs.showQuestionByQuestion !== false;

  const questionsById = await loadQuestionsById(attempt);
  const scoreKnown = attempt.totalScore !== null && attempt.totalScore !== undefined;
  const percentage = scoreKnown && quiz.totalMarks > 0 ? Math.round((attempt.totalScore / quiz.totalMarks) * 10000) / 100 : null;

  return {
    _id: attempt._id,
    quiz: quiz._id,
    resultState: 'available',
    status: attempt.status,
    participant: attempt.participant,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    totalMarks: quiz.totalMarks,
    totalScore: showScore ? attempt.totalScore : undefined,
    percentage: showPercentage ? percentage : undefined,
    passed: showPassFail && scoreKnown ? attempt.totalScore >= quiz.passingMarks : undefined,
    needsManualGrading: attempt.needsManualGrading,
    correctCount: showQuestionByQuestion ? attempt.answers.filter((a) => a.isCorrect === true).length : undefined,
    incorrectCount: showQuestionByQuestion ? attempt.answers.filter((a) => a.isCorrect === false).length : undefined,
    unansweredCount: showQuestionByQuestion
      ? attempt.answers.filter((a) => a.isCorrect === null && a.marksAwarded === null).length
      : undefined,
    answers: showQuestionByQuestion
      ? attempt.answers.map((a) => {
          const q = questionsById.get(String(a.question));
          return {
            question: a.question,
            questionText: q?.text,
            questionType: q?.type,
            selectedOptionIds: a.selectedOptionIds,
            textAnswers: a.textAnswers,
            numericalAnswer: a.numericalAnswer,
            matchingAnswer: a.matchingAnswer,
            marksAwarded: showScore ? a.marksAwarded : undefined,
            isCorrect: showScore ? a.isCorrect : undefined,
            options: showCorrectAnswers ? q?.options?.map((o) => ({ _id: o._id, text: o.text })) : undefined,
            correctOptionIds: showCorrectAnswers ? q?.options?.filter((o) => o.isCorrect).map((o) => o._id) : undefined,
            correctTextAnswers: showCorrectAnswers ? q?.correctTextAnswers : undefined,
            correctMatchingPairs: showCorrectAnswers ? q?.matchingPairs : undefined,
            correctNumericalAnswer: showCorrectAnswers ? q?.numericalAnswer : undefined,
            explanation: showExplanations ? q?.explanation : undefined,
          };
        })
      : undefined,
  };
}
