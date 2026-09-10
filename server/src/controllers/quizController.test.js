import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Course from '../models/Course.js';
import Question from '../models/Question.js';
import Quiz from '../models/Quiz.js';
import Settings from '../models/Settings.js';
import { createQuiz, updateQuiz, startAttempt } from './quizController.js';

// Exercises createQuiz/updateQuiz/startAttempt directly (asyncHandler-wrapped,
// so a thrown ApiError is forwarded to `next` rather than rejecting) against
// a real disposable local MongoDB — same convention as authController.test.js.
// The point of this suite: every quiz startAt/endAt a faculty member types
// into a `datetime-local` input (a bare "YYYY-MM-DDTHH:mm" string with no
// timezone info) must be stored as the correct UTC instant for Bangladesh
// Standard Time (Asia/Dhaka, UTC+06:00) — never the server process's own
// timezone — per server/src/utils/timezone.js.
function fakeRes() {
  const res = { statusCode: 200 };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

async function call(fn, { user, params = {}, body = {} } = {}) {
  const req = { user, params, body };
  const res = fakeRes();
  let error;
  await fn(req, res, (err) => {
    error = err;
  });
  return { res, error };
}

before(async () => {
  await connectTestDb('quiz-timezone');
});

after(async () => {
  await dropAndDisconnect();
});

let faculty;
let student;
let question;

beforeEach(async () => {
  await clearCollections(User, Department, Course, Question, Quiz, Settings);
  await Settings.create({ key: 'global', quizSystemEnabled: true, publicExamsEnabled: true });

  const department = await Department.create({ name: 'Computer Science', code: 'CSE' });
  const course = await Course.create({ name: 'Algorithms', courseId: 'CSE101', department: department._id });

  faculty = await User.create({
    name: 'Test Faculty',
    email: 'faculty@test.local',
    password: 'password123',
    role: 'faculty',
    assignedDepartments: [department._id],
    assignedCourses: [course._id],
  });

  student = await User.create({
    name: 'Test Student',
    email: 'student@test.local',
    password: 'password123',
    role: 'student',
    department: department._id,
    approvalStatus: 'approved',
  });

  question = await Question.create({
    department: department._id,
    course: course._id,
    type: 'true_false',
    text: 'Is this a test question?',
    options: [
      { text: 'True', isCorrect: true },
      { text: 'False', isCorrect: false },
    ],
    defaultMarks: 1,
    createdBy: faculty._id,
  });
});

function basePublicQuizBody(overrides = {}) {
  return {
    title: 'Timezone Test Quiz',
    description: '',
    examType: 'public',
    duration: 30,
    startAt: '2026-09-11T10:00',
    endAt: '2026-09-11T12:00',
    questions: [{ questionId: String(question._id), marks: 1, order: 0 }],
    publicAccess: { publicName: 'Timezone Test Quiz', slug: '', passwordEnabled: false, loginRequirement: 'guest' },
    status: 'draft',
    ...overrides,
  };
}

describe('createQuiz — Bangladesh Standard Time interpretation', () => {
  test('a bare datetime-local startAt/endAt is stored as the correct UTC instant', async () => {
    const { res, error } = await call(createQuiz, { user: faculty, body: basePublicQuizBody() });
    assert.equal(error, undefined);
    assert.equal(res.statusCode, 201);
    // Spec example: 10:00 AM / 12:00 PM Bangladesh -> 04:00Z / 06:00Z
    assert.equal(new Date(res.body.data.startAt).toISOString(), '2026-09-11T04:00:00.000Z');
    assert.equal(new Date(res.body.data.endAt).toISOString(), '2026-09-11T06:00:00.000Z');

    const stored = await Quiz.findById(res.body.data._id);
    assert.equal(stored.startAt.toISOString(), '2026-09-11T04:00:00.000Z');
    assert.equal(stored.endAt.toISOString(), '2026-09-11T06:00:00.000Z');
  });

  test('an already-UTC ISO string (explicit Z) is trusted as-is, not double-converted', async () => {
    const { res, error } = await call(createQuiz, {
      user: faculty,
      body: basePublicQuizBody({ startAt: '2026-09-11T04:00:00.000Z', endAt: '2026-09-11T06:00:00.000Z' }),
    });
    assert.equal(error, undefined);
    assert.equal(new Date(res.body.data.startAt).toISOString(), '2026-09-11T04:00:00.000Z');
    assert.equal(new Date(res.body.data.endAt).toISOString(), '2026-09-11T06:00:00.000Z');
  });

  test('a cross-midnight window (11 PM -> 1 AM Dhaka) is accepted as a valid two-hour window', async () => {
    const { res, error } = await call(createQuiz, {
      user: faculty,
      body: basePublicQuizBody({ startAt: '2026-09-11T23:00', endAt: '2026-09-12T01:00' }),
    });
    assert.equal(error, undefined);
    assert.equal(res.statusCode, 201);
    const start = new Date(res.body.data.startAt);
    const end = new Date(res.body.data.endAt);
    assert.equal(start.toISOString(), '2026-09-11T17:00:00.000Z');
    assert.equal(end.toISOString(), '2026-09-11T19:00:00.000Z');
    assert.equal(end.getTime() - start.getTime(), 2 * 60 * 60 * 1000);
  });

  test('rejects endAt before startAt, evaluated on the converted instants (not raw strings)', async () => {
    // 12:00 PM start, 10:00 AM end — invalid even though "10:00" < "12:00"
    // isn't the point here; the point is this must fail after conversion.
    const { error } = await call(createQuiz, {
      user: faculty,
      body: basePublicQuizBody({ startAt: '2026-09-11T12:00', endAt: '2026-09-11T10:00' }),
    });
    assert.ok(error);
    assert.match(error.message, /end time must be after/i);
  });

  test('rejects a same start/end instant', async () => {
    const { error } = await call(createQuiz, {
      user: faculty,
      body: basePublicQuizBody({ startAt: '2026-09-11T10:00', endAt: '2026-09-11T10:00' }),
    });
    assert.ok(error);
  });

  test('rejects an unparseable startAt', async () => {
    const { error } = await call(createQuiz, {
      user: faculty,
      body: basePublicQuizBody({ startAt: 'not-a-date' }),
    });
    assert.ok(error);
    assert.match(error.message, /valid date/i);
  });
});

describe('updateQuiz — Bangladesh Standard Time interpretation', () => {
  async function createBaseQuiz() {
    const { res } = await call(createQuiz, { user: faculty, body: basePublicQuizBody() });
    return res.body.data._id;
  }

  test('editing startAt/endAt re-applies the same Dhaka-local interpretation', async () => {
    const quizId = await createBaseQuiz();
    const { res, error } = await call(updateQuiz, {
      user: faculty,
      params: { id: quizId },
      body: { startAt: '2026-09-15T09:00', endAt: '2026-09-15T11:30' },
    });
    assert.equal(error, undefined);
    assert.equal(new Date(res.body.data.startAt).toISOString(), '2026-09-15T03:00:00.000Z');
    assert.equal(new Date(res.body.data.endAt).toISOString(), '2026-09-15T05:30:00.000Z');
  });

  test('leaving startAt/endAt untouched on an unrelated field update does not corrupt the stored instant', async () => {
    const quizId = await createBaseQuiz();
    const { res, error } = await call(updateQuiz, {
      user: faculty,
      params: { id: quizId },
      body: { title: 'Renamed Quiz' },
    });
    assert.equal(error, undefined);
    assert.equal(res.body.data.title, 'Renamed Quiz');
    assert.equal(new Date(res.body.data.startAt).toISOString(), '2026-09-11T04:00:00.000Z');
    assert.equal(new Date(res.body.data.endAt).toISOString(), '2026-09-11T06:00:00.000Z');
  });

  test('rejects an update that would make endAt before startAt', async () => {
    const quizId = await createBaseQuiz();
    const { error } = await call(updateQuiz, {
      user: faculty,
      params: { id: quizId },
      body: { endAt: '2026-09-11T00:00' }, // before the existing 04:00Z startAt
    });
    assert.ok(error);
    assert.match(error.message, /end time must be after/i);
  });
});

describe('startAttempt — availability enforced against the true UTC instant, not any local clock', () => {
  async function createPublishedQuiz(overrides) {
    const { res } = await call(createQuiz, {
      user: faculty,
      body: basePublicQuizBody({ status: 'published', ...overrides }),
    });
    return res.body.data._id;
  }

  test('a quiz scheduled to start in the future (Dhaka time) is not startable yet', async () => {
    const quizId = await createPublishedQuiz();
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await Quiz.findByIdAndUpdate(quizId, { startAt: future, endAt: new Date(future.getTime() + 60 * 60 * 1000) });

    const { error } = await call(startAttempt, { user: student, params: { id: quizId } });
    assert.ok(error);
    assert.match(error.message, /not started yet/i);
  });

  test('a quiz whose window has already closed (converted correctly to UTC) cannot be started', async () => {
    const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const quizId = await createPublishedQuiz();
    await Quiz.findByIdAndUpdate(quizId, { startAt: past, endAt: new Date(past.getTime() + 60 * 60 * 1000) });

    const { error } = await call(startAttempt, { user: student, params: { id: quizId } });
    assert.ok(error);
    assert.match(error.message, /window has closed/i);
  });

  test('a quiz within its Dhaka-time window right now is startable', async () => {
    const quizId = await createPublishedQuiz();
    const now = new Date();
    await Quiz.findByIdAndUpdate(quizId, {
      startAt: new Date(now.getTime() - 60 * 60 * 1000),
      endAt: new Date(now.getTime() + 60 * 60 * 1000),
    });

    const { error } = await call(startAttempt, { user: student, params: { id: quizId } });
    assert.equal(error, undefined);
  });
});
