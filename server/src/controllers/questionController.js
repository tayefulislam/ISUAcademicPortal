import Question from '../models/Question.js';
import Quiz from '../models/Quiz.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { parsePagination } from '../utils/pagination.js';
import { storeUploadedFile, deleteStoredFile } from '../services/storage/storageService.js';
import {
  tokenize,
  scoreDocument,
  suggestCorrection,
  sanitizeQuery,
  CANDIDATE_CAP,
  FIELD_WEIGHTS,
} from '../utils/textSearch.js';

const POPULATE = [
  { path: 'department', select: 'name code' },
  { path: 'course', select: 'name courseId' },
  { path: 'chapter', select: 'name' },
  { path: 'topic', select: 'name' },
  { path: 'createdBy', select: 'name role' },
];

// Faculty may only add questions to their own assigned Department/Course —
// same rule already used for Notices/Assignments (noticeController.js /
// assignmentController.js), applied here to a single dept+course pair.
function assertFacultyScope(departmentId, courseId, user) {
  const deptIds = new Set((user.assignedDepartments || []).map(String));
  const courseIds = new Set((user.assignedCourses || []).map(String));
  if (!deptIds.has(String(departmentId)) && !courseIds.has(String(courseId))) {
    throw new ApiError(403, 'You can only add questions for your own assigned Department/Course', null, 'FORBIDDEN');
  }
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function validateByType(type, body) {
  const options = parseJsonArray(body.options);
  switch (type) {
    case 'mcq':
    case 'true_false': {
      if (options.length < 2) throw new ApiError(400, 'At least 2 options are required');
      if (options.filter((o) => o.isCorrect).length !== 1) throw new ApiError(400, `${type} needs exactly one correct option`);
      break;
    }
    case 'multi_select': {
      if (options.length < 2) throw new ApiError(400, 'At least 2 options are required');
      if (!options.some((o) => o.isCorrect)) throw new ApiError(400, 'At least one option must be marked correct');
      break;
    }
    case 'short_answer':
    case 'fill_blank': {
      if (!parseJsonArray(body.correctTextAnswers).length) throw new ApiError(400, 'At least one accepted answer is required');
      break;
    }
    case 'matching': {
      if (parseJsonArray(body.matchingPairs).length < 2) throw new ApiError(400, 'At least 2 matching pairs are required');
      break;
    }
    case 'numerical': {
      if (body.numericalAnswer === undefined || body.numericalAnswer === '') throw new ApiError(400, 'numericalAnswer is required');
      break;
    }
    case 'long_answer':
      break; // free text, manually graded — nothing to validate
    default:
      throw new ApiError(400, 'Invalid question type');
  }
}

function parseTags(value) {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return [...new Set(raw.map((t) => String(t).trim().toLowerCase()).filter(Boolean))];
}

export const createQuestion = asyncHandler(async (req, res) => {
  const { department, course, chapter, topic, type, text, explanation, defaultMarks, difficulty } = req.body;
  if (!department || !course) throw new ApiError(400, 'Department and course are required');
  if (req.user.role === 'faculty') assertFacultyScope(department, course, req.user);

  validateByType(type, req.body);

  let image = { imageUrl: '', imageStorageProvider: '', imageStorageRef: '' };
  if (req.file) {
    const stored = await storeUploadedFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    image = { imageUrl: stored.fileUrl, imageStorageProvider: stored.storageProvider, imageStorageRef: stored.storageRef };
  }

  const question = await Question.create({
    department,
    course,
    chapter: chapter || null,
    topic: topic || null,
    type,
    text,
    explanation: explanation || '',
    defaultMarks: defaultMarks ? Number(defaultMarks) : 1,
    difficulty: ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium',
    tags: parseTags(req.body.tags),
    negativeMarks: req.body.negativeMarks ? Number(req.body.negativeMarks) : 0,
    options: parseJsonArray(req.body.options),
    correctTextAnswers: parseJsonArray(req.body.correctTextAnswers),
    matchingPairs: parseJsonArray(req.body.matchingPairs),
    numericalAnswer: req.body.numericalAnswer !== undefined && req.body.numericalAnswer !== '' ? Number(req.body.numericalAnswer) : null,
    numericalTolerance: req.body.numericalTolerance ? Number(req.body.numericalTolerance) : 0,
    visibility: req.body.visibility === 'public' ? 'public' : 'private',
    ...image,
    createdBy: req.user._id,
  });

  res.status(201).json({ success: true, data: question });
});

export const updateQuestion = asyncHandler(async (req, res) => {
  const question = await Question.findById(req.params.id);
  if (!question) throw new ApiError(404, 'Question not found');
  if (req.user.role !== 'super_admin' && req.user.role !== 'administrator' && !question.createdBy.equals(req.user._id)) {
    throw new ApiError(403, 'You can only edit questions you created', null, 'FORBIDDEN');
  }

  const type = req.body.type || question.type;
  if (req.body.type || req.body.options || req.body.correctTextAnswers || req.body.matchingPairs || req.body.numericalAnswer !== undefined) {
    validateByType(type, { ...req.body, options: req.body.options ?? question.options, correctTextAnswers: req.body.correctTextAnswers ?? question.correctTextAnswers, matchingPairs: req.body.matchingPairs ?? question.matchingPairs, numericalAnswer: req.body.numericalAnswer ?? question.numericalAnswer });
  }

  const scalarFields = ['text', 'explanation', 'chapter', 'topic'];
  for (const key of scalarFields) {
    if (req.body[key] !== undefined) question[key] = req.body[key] || null;
  }
  if (req.body.type) question.type = req.body.type;
  if (req.body.defaultMarks !== undefined) question.defaultMarks = Number(req.body.defaultMarks);
  if (req.body.difficulty !== undefined && ['easy', 'medium', 'hard'].includes(req.body.difficulty)) question.difficulty = req.body.difficulty;
  if (req.body.tags !== undefined) question.tags = parseTags(req.body.tags);
  if (req.body.negativeMarks !== undefined) question.negativeMarks = Number(req.body.negativeMarks) || 0;
  if (req.body.options !== undefined) question.options = parseJsonArray(req.body.options);
  if (req.body.correctTextAnswers !== undefined) question.correctTextAnswers = parseJsonArray(req.body.correctTextAnswers);
  if (req.body.matchingPairs !== undefined) question.matchingPairs = parseJsonArray(req.body.matchingPairs);
  if (req.body.numericalAnswer !== undefined) question.numericalAnswer = req.body.numericalAnswer === '' ? null : Number(req.body.numericalAnswer);
  if (req.body.numericalTolerance !== undefined) question.numericalTolerance = Number(req.body.numericalTolerance);
  if (req.body.visibility !== undefined) question.visibility = req.body.visibility === 'public' ? 'public' : 'private';

  if (req.file) {
    if (question.imageStorageRef) await deleteStoredFile({ storageProvider: question.imageStorageProvider, storageRef: question.imageStorageRef }).catch(() => null);
    const stored = await storeUploadedFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    question.imageUrl = stored.fileUrl;
    question.imageStorageProvider = stored.storageProvider;
    question.imageStorageRef = stored.storageRef;
  }

  await question.save();
  res.json({ success: true, data: question });
});

export const deleteQuestion = asyncHandler(async (req, res) => {
  const question = await Question.findById(req.params.id);
  if (!question) throw new ApiError(404, 'Question not found');
  if (req.user.role !== 'super_admin' && req.user.role !== 'administrator' && !question.createdBy.equals(req.user._id)) {
    throw new ApiError(403, 'You can only delete questions you created', null, 'FORBIDDEN');
  }

  const inUse = await Quiz.exists({ 'questions.question': question._id });
  if (inUse) throw new ApiError(409, 'Cannot delete a question that is used in a quiz — remove it from the quiz first');

  if (question.imageStorageRef) await deleteStoredFile({ storageProvider: question.imageStorageProvider, storageRef: question.imageStorageRef }).catch(() => null);
  await question.deleteOne();

  res.json({ success: true, message: 'Question deleted' });
});

// GET /questions — the shared bank, organized by Department/Course. Faculty
// are restricted to their own assigned scope; Admin/Super Admin can browse
// any department/course.

// Builds the cheap, indexed Mongo scope filter shared by listQuestions and
// searchQuestions — everything EXCEPT the free-text `q` term, which is
// handled separately (in memory, fuzzy-ranked) rather than as a DB regex.
// This is also what keeps the fuzzy engine from ever scanning the whole
// collection: department/course/etc narrow the candidate set first, using
// existing indexes (Question.js's schema indexes on department+course,
// chapter, topic, type, difficulty, tags).
function buildScopeFilter(req) {
  const { department, course, chapter, topic, type, difficulty, tags } = req.query;
  const filter = { status: 'active' };
  const ands = [];

  if (req.user.role === 'faculty') {
    const deptIds = (req.user.assignedDepartments || []).map(String);
    const courseIds = (req.user.assignedCourses || []).map(String);
    if (department && !deptIds.includes(String(department)) && !(course && courseIds.includes(String(course)))) {
      throw new ApiError(403, 'You can only browse your own assigned Department/Course', null, 'FORBIDDEN');
    }
    ands.push({ $or: [{ department: { $in: deptIds } }, { course: { $in: courseIds } }] });
    // Within scope, faculty only ever see their own questions plus anything
    // marked public by others — private questions stay invisible to everyone
    // but their creator (Super Admin skips this branch entirely).
    ands.push({ $or: [{ createdBy: req.user._id }, { visibility: 'public' }] });
  }

  if (department) filter.department = department;
  if (course) filter.course = course;
  if (chapter) filter.chapter = chapter;
  if (topic) filter.topic = topic;
  if (type) filter.type = type;
  if (difficulty) filter.difficulty = difficulty;
  if (tags) filter.tags = { $in: [].concat(tags).flatMap((t) => String(t).split(',')).map((t) => t.trim().toLowerCase()).filter(Boolean) };
  if (ands.length) filter.$and = ands;
  return filter;
}

// The searchable, weighted fields for one question document — configurable
// per FIELD_WEIGHTS (server/src/utils/textSearch.js). `doc` must be
// populated with department/course/topic (see POPULATE) for the
// subject/topic fields to have content.
function searchFieldsFor(doc) {
  return [
    { key: 'questionText', weight: FIELD_WEIGHTS.questionText, value: doc.text },
    { key: 'tags', weight: FIELD_WEIGHTS.tags, value: doc.tags || [] },
    { key: 'topic', weight: FIELD_WEIGHTS.topic, value: doc.topic?.name || '' },
    { key: 'subject', weight: FIELD_WEIGHTS.subject, value: [doc.course?.name, doc.department?.name].filter(Boolean) },
    { key: 'options', weight: FIELD_WEIGHTS.options, value: (doc.options || []).map((o) => o.text) },
    { key: 'answer', weight: FIELD_WEIGHTS.options, value: doc.correctTextAnswers || [] },
    { key: 'explanation', weight: FIELD_WEIGHTS.explanation, value: doc.explanation || '' },
  ];
}

// Fetches a bounded candidate set (scope filter + CANDIDATE_CAP — never the
// whole collection) and fuzzy-ranks it against `q`. Returns
// `{ ranked, queryTokens }` where `ranked` is every candidate that matched
// at all, sorted by score descending, each entry `{ doc, score, matchType }`.
async function fuzzyRank(req, q) {
  const filter = buildScopeFilter(req);
  const candidates = await Question.find(filter).populate(POPULATE).sort({ createdAt: -1 }).limit(CANDIDATE_CAP);

  const queryTokens = tokenize(q);
  const ranked = [];
  for (const doc of candidates) {
    const result = scoreDocument(queryTokens, searchFieldsFor(doc));
    if (result) ranked.push({ doc, score: result.score, matchType: result.matchType });
  }
  ranked.sort((a, b) => b.score - a.score);
  return { ranked, queryTokens, candidates };
}

export const listQuestions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const q = sanitizeQuery(req.query.q);

  // No search term (or too short to search meaningfully) — the original,
  // fully DB-side paginated path, unchanged.
  if (q.length < 2) {
    const filter = buildScopeFilter(req);
    const [questions, total] = await Promise.all([
      Question.find(filter).populate(POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Question.countDocuments(filter),
    ]);
    return res.json({
      success: true,
      data: questions,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  }

  // Fuzzy/typo-tolerant path — see server/src/utils/textSearch.js. Ranking
  // happens over a bounded, already-scoped candidate set, then pagination
  // is applied in memory to that ranked list.
  const { ranked } = await fuzzyRank(req, q);
  const total = ranked.length;
  const start = (page - 1) * limit;
  const pageItems = ranked.slice(start, start + limit).map((r) => r.doc);

  res.json({
    success: true,
    data: pageItems,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

// GET /questions/search — the same fuzzy engine as listQuestions, shaped
// into a dedicated response with match metadata and a "did you mean"
// correction, for a richer search UI (highlighting, score display, etc.)
// than the plain Question Bank list needs.
export const searchQuestions = asyncHandler(async (req, res) => {
  const q = sanitizeQuery(req.query.q);
  const { page, limit } = parsePagination(req.query);

  if (q.length < 2) {
    return res.json({ query: q, correctedQuery: null, suggestion: null, results: [], pagination: { page: 1, limit, total: 0, totalPages: 0 } });
  }

  const { ranked, queryTokens, candidates } = await fuzzyRank(req, q);
  const topType = ranked[0]?.matchType || 'none';
  const corpus = candidates.flatMap((d) => [d.text, ...(d.tags || [])]);
  const suggestion = suggestCorrection(queryTokens, corpus, topType);

  const total = ranked.length;
  const start = (page - 1) * limit;
  const pageItems = ranked.slice(start, start + limit);

  res.json({
    query: q,
    correctedQuery: suggestion,
    suggestion,
    results: pageItems.map((r) => ({
      id: r.doc._id,
      questionText: r.doc.text,
      type: r.doc.type,
      difficulty: r.doc.difficulty,
      tags: r.doc.tags,
      course: r.doc.course,
      department: r.doc.department,
      score: Math.round((r.score / (FIELD_WEIGHTS.questionText * 3)) * 100) / 100, // roughly normalized 0..~1
      matchType: r.matchType,
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// GET /questions/suggestions?q= — lightweight autocomplete/typeahead: real
// whole words drawn from the scoped candidate set's own question text/tags
// that start with (or closely resemble) the query, plus a spelling
// correction when nothing starts with it. Never returns fabricated words —
// only terms that actually exist in the bank, per spec.
export const suggestQuestions = asyncHandler(async (req, res) => {
  const q = sanitizeQuery(req.query.q);
  if (q.length < 2) return res.json({ success: true, data: [] });

  const filter = buildScopeFilter(req);
  const candidates = await Question.find(filter).select('text tags').limit(CANDIDATE_CAP);

  const queryToken = tokenize(q)[0] || '';
  const freq = new Map();
  for (const doc of candidates) {
    for (const t of tokenize(doc.text)) freq.set(t, (freq.get(t) || 0) + 1);
    for (const t of doc.tags || []) freq.set(t, (freq.get(t) || 0) + 1);
  }

  const startsWith = [...freq.entries()]
    .filter(([word]) => word.length > queryToken.length && word.startsWith(queryToken))
    .sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)
    .slice(0, 8)
    .map(([word]) => word);

  res.json({ success: true, data: startsWith });
});

export const getQuestion = asyncHandler(async (req, res) => {
  const question = await Question.findById(req.params.id).populate(POPULATE);
  if (!question) throw new ApiError(404, 'Question not found');
  if (
    req.user.role === 'faculty' &&
    question.visibility === 'private' &&
    String(question.createdBy?._id || question.createdBy) !== String(req.user._id)
  ) {
    throw new ApiError(403, 'This question is private to its creator', null, 'FORBIDDEN');
  }
  res.json({ success: true, data: question });
});
