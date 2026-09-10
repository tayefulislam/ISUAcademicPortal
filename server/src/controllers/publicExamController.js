// The public-facing access layer for Public Exams. Every bit of actual
// timer/grading/attempt logic below is delegated to examEngine.js — the
// exact same functions quizController.js uses for authenticated course
// quizzes. This controller's only job is resolving "who is this
// participant and are they allowed to be here" for someone who may not
// have (or may not be using) an account.
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import Quiz from '../models/Quiz.js';
import QuizAttempt from '../models/QuizAttempt.js';
import { getSettings } from '../models/Settings.js';
import { isSuperAdminTier } from '../models/Role.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  generateAttemptSnapshot,
  hydrateAttemptForStudent,
  isExpired,
  finalizeAttempt,
  buildPublicResultView,
} from '../services/examEngine.js';

const PASSWORD_TOKEN_TTL = '30m';

async function assertPublicExamsEnabled() {
  const settings = await getSettings();
  if (!settings.publicExamsEnabled) throw new ApiError(400, 'Public exams are currently disabled', null, 'PUBLIC_EXAMS_DISABLED');
}

async function loadPublicQuiz(slug, { forAttempt = false } = {}) {
  const query = Quiz.findOne({ 'publicAccess.slug': slug, examType: 'public' });
  if (forAttempt) query.populate({ path: 'questions.question' });
  const quiz = await query;
  // Deliberately generic — never reveals whether a slug exists but is
  // private/course-type vs. doesn't exist at all.
  if (!quiz || !quiz.publicAccess?.enabled) throw new ApiError(404, 'This exam is not available');
  return quiz;
}

function derivedStatus(quiz) {
  if (quiz.publicAccess?.disabled) return 'disabled';
  if (quiz.status === 'draft') return 'draft';
  if (quiz.status === 'closed') return 'archived';
  const now = Date.now();
  if (now < new Date(quiz.startAt).getTime()) return 'scheduled';
  if (now > new Date(quiz.endAt).getTime()) return 'expired';
  return 'active';
}

// GET /public-exams/:slug — landing info only, never questions/answers/
// password/creator-private-info.
export const getLanding = asyncHandler(async (req, res) => {
  const quiz = await loadPublicQuiz(req.params.slug).catch(() => null);
  if (!quiz) throw new ApiError(404, 'This exam is not available');
  await quiz.populate({ path: 'createdBy', select: 'name' });

  const questionCount =
    quiz.questionSelection?.mode === 'random'
      ? quiz.questionSelection.rules.reduce((sum, r) => sum + r.count, 0)
      : quiz.questions.length;

  res.json({
    success: true,
    data: {
      slug: quiz.publicAccess.slug,
      title: quiz.publicAccess.publicName || quiz.title,
      description: quiz.description,
      questionCount,
      duration: quiz.duration,
      totalMarks: quiz.totalMarks,
      createdByName: quiz.createdBy?.name || 'Faculty',
      startAt: quiz.startAt,
      endAt: quiz.endAt,
      passwordEnabled: !!quiz.publicAccess.passwordEnabled,
      participantFields: quiz.publicAccess.participantFields,
      loginRequirement: quiz.publicAccess.loginRequirement,
      attemptLimit: quiz.publicAccess.attemptLimit,
      status: derivedStatus(quiz),
    },
  });
});

// POST /public-exams/:slug/password
export const verifyPassword = asyncHandler(async (req, res) => {
  const quiz = await Quiz.findOne({ 'publicAccess.slug': req.params.slug, examType: 'public' }).select('+publicAccess.passwordHash');
  if (!quiz || !quiz.publicAccess?.enabled) throw new ApiError(404, 'This exam is not available');
  if (!quiz.publicAccess.passwordEnabled) return res.json({ success: true, data: { passwordToken: null } });

  const { password } = req.body;
  if (!password) throw new ApiError(400, 'Password is required');

  const match = await bcrypt.compare(String(password), quiz.publicAccess.passwordHash || '');
  if (!match) throw new ApiError(401, 'Incorrect password', null, 'INCORRECT_PASSWORD');

  const passwordToken = jwt.sign({ quizId: quiz._id.toString(), passwordVerified: true }, env.jwtSecret, { expiresIn: PASSWORD_TOKEN_TTL });
  res.json({ success: true, data: { passwordToken } });
});

function assertParticipantFields(fields, participant) {
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const key of ['name', 'email', 'phone']) {
    const mode = fields?.[key] || 'disabled';
    const value = String(participant?.[key] || '').trim();
    if (mode === 'required' && !value) {
      throw new ApiError(400, `${key === 'name' ? 'Full name' : key[0].toUpperCase() + key.slice(1)} is required`);
    }
    if (key === 'email' && value && !emailRe.test(value)) {
      throw new ApiError(400, 'A valid email address is required');
    }
  }
}

function verifyPasswordToken(token, quizId) {
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    return payload.passwordVerified && String(payload.quizId) === String(quizId);
  } catch {
    return false;
  }
}

// POST /public-exams/:slug/start — optionalAuth so a logged-in student's
// identity is captured while guests can still proceed. Every enforcement
// point (window, disabled, login requirement, password, attempt limit) is
// server-side — never trust a client-computed "can I start" flag.
export const startPublicAttempt = asyncHandler(async (req, res) => {
  await assertPublicExamsEnabled();
  const quiz = await loadPublicQuiz(req.params.slug, { forAttempt: true });

  if (quiz.publicAccess.disabled) throw new ApiError(400, 'This exam is currently unavailable');
  if (quiz.status !== 'published') throw new ApiError(400, 'This exam is not available');
  const now = Date.now();
  if (now < new Date(quiz.startAt).getTime()) throw new ApiError(400, 'This exam has not started yet');
  if (now > new Date(quiz.endAt).getTime()) throw new ApiError(400, 'This exam window has closed');

  if (quiz.publicAccess.loginRequirement === 'required' && !req.user) {
    throw new ApiError(401, 'You must be logged in to take this exam', null, 'LOGIN_REQUIRED');
  }

  if (quiz.publicAccess.passwordEnabled && !verifyPasswordToken(req.body.passwordToken, quiz._id)) {
    throw new ApiError(401, 'Password verification is required or has expired — please re-enter the password', null, 'PASSWORD_REQUIRED');
  }

  const participant = {
    name: String(req.body.participant?.name || (req.user ? req.user.name : '') || '').trim(),
    email: String(req.body.participant?.email || (req.user ? req.user.email : '') || '').trim().toLowerCase(),
    phone: String(req.body.participant?.phone || '').trim(),
  };
  if (!req.user) assertParticipantFields(quiz.publicAccess.participantFields, participant);

  const incomingToken = req.headers['x-attempt-token'];

  // Resume an existing in-progress attempt before creating a new one.
  let existing = null;
  if (req.user) {
    existing = await QuizAttempt.findOne({ quiz: quiz._id, student: req.user._id, status: 'in_progress' });
  } else if (incomingToken) {
    existing = await QuizAttempt.findOne({ quiz: quiz._id, guestToken: incomingToken, status: 'in_progress' }).select('+guestToken');
  }
  if (existing) {
    return res.json({ success: true, data: { ...(await hydrateAttemptForStudent(existing, quiz)), guestToken: existing.guestToken } });
  }

  // Attempt-limit — best-effort for guests (see examEngine/model comments):
  // counted by account for logged-in participants, by collected email for
  // guests who supplied one. A guest who supplies no email and clears their
  // browser storage cannot be reliably limited — this is a known, accepted
  // limitation, not a security promise.
  const { type: limitType, max: limitMax } = quiz.publicAccess.attemptLimit || {};
  if (limitType !== 'unlimited') {
    const limit = limitType === 'max' ? limitMax || 1 : 1;
    const countFilter = req.user ? { quiz: quiz._id, student: req.user._id } : participant.email ? { quiz: quiz._id, 'participant.email': participant.email } : null;
    if (countFilter) {
      const count = await QuizAttempt.countDocuments(countFilter);
      if (count >= limit) throw new ApiError(409, 'You have no attempts remaining for this exam');
    }
  }

  const { questionOrder, optionOrder, assignedMarks } = await generateAttemptSnapshot(quiz);
  const attemptNumber = req.user
    ? (await QuizAttempt.countDocuments({ quiz: quiz._id, student: req.user._id })) + 1
    : participant.email
    ? (await QuizAttempt.countDocuments({ quiz: quiz._id, 'participant.email': participant.email })) + 1
    : 1;

  const attempt = await QuizAttempt.create({
    quiz: quiz._id,
    student: req.user?._id,
    isGuestAttempt: !req.user,
    participant,
    guestToken: req.user ? undefined : crypto.randomBytes(24).toString('hex'),
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'] || '',
    attemptNumber,
    questionOrder,
    optionOrder,
    assignedMarks,
    answers: [],
  });

  res.status(201).json({ success: true, data: { ...(await hydrateAttemptForStudent(attempt, quiz)), guestToken: attempt.guestToken } });
});

// Resolves quiz + attempt + ownership for the get/save/submit/result
// endpoints below — guests prove ownership via the `X-Attempt-Token`
// header (their guestToken), logged-in participants via req.user.
async function loadPublicAttempt(slug, attemptId, req) {
  const quiz = await Quiz.findOne({ 'publicAccess.slug': slug, examType: 'public' }).populate({ path: 'questions.question' });
  if (!quiz) throw new ApiError(404, 'This exam is not available');

  const attempt = await QuizAttempt.findById(attemptId).select('+guestToken');
  if (!attempt || String(attempt.quiz) !== String(quiz._id)) throw new ApiError(404, 'Attempt not found');

  const isManager = !!req.user && (isSuperAdminTier(req.user.role) || quiz.createdBy.equals(req.user._id));
  let isOwner = false;
  if (attempt.isGuestAttempt) {
    const token = req.headers['x-attempt-token'];
    isOwner = !!token && token === attempt.guestToken;
  } else {
    isOwner = !!req.user && attempt.student.equals(req.user._id);
  }
  if (!isOwner && !isManager) throw new ApiError(403, 'Not your attempt', null, 'FORBIDDEN');

  return { attempt, quiz, isOwner, isManager };
}

export const getPublicAttempt = asyncHandler(async (req, res) => {
  const { attempt, quiz, isOwner, isManager } = await loadPublicAttempt(req.params.slug, req.params.attemptId, req);

  if (isOwner && attempt.status === 'in_progress') {
    if (isExpired(attempt, quiz)) {
      await finalizeAttempt(attempt, quiz);
    } else {
      return res.json({ success: true, data: await hydrateAttemptForStudent(attempt, quiz) });
    }
  }

  res.json({ success: true, data: await buildPublicResultView(attempt, quiz, isManager) });
});

export const savePublicAnswer = asyncHandler(async (req, res) => {
  const { attempt, quiz, isOwner } = await loadPublicAttempt(req.params.slug, req.params.attemptId, req);
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

// Submission is idempotent (finalizeAttempt is only invoked while still
// in_progress) — a duplicate submit for an already-finalized attempt simply
// returns the existing result instead of re-scoring, so a retried/double
// click can never double-count or overwrite a score.
export const submitPublicAttempt = asyncHandler(async (req, res) => {
  const { attempt, quiz, isOwner, isManager } = await loadPublicAttempt(req.params.slug, req.params.attemptId, req);
  if (!isOwner) throw new ApiError(403, 'Not your attempt', null, 'FORBIDDEN');

  if (attempt.status === 'in_progress') {
    await finalizeAttempt(attempt, quiz);
  }

  res.json({ success: true, data: await buildPublicResultView(attempt, quiz, isManager) });
});

export const getPublicResult = asyncHandler(async (req, res) => {
  const { attempt, quiz, isOwner, isManager } = await loadPublicAttempt(req.params.slug, req.params.attemptId, req);
  if (!isOwner && !isManager) throw new ApiError(403, 'Not your attempt', null, 'FORBIDDEN');
  if (attempt.status === 'in_progress' && isExpired(attempt, quiz)) {
    await finalizeAttempt(attempt, quiz);
  }
  res.json({ success: true, data: await buildPublicResultView(attempt, quiz, isManager) });
});
