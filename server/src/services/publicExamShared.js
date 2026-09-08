// Shared between quizController.js (create/update a public exam) and
// publicExamController.js (the public-facing access layer) — slug
// generation/validation and password hashing live here once instead of
// being duplicated in both places.
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import Quiz from '../models/Quiz.js';
import { getSettings } from '../models/Settings.js';
import { ApiError } from '../utils/ApiError.js';

const PARTICIPANT_FIELD_MODES = ['required', 'optional', 'disabled'];
const LOGIN_REQUIREMENTS = ['guest', 'optional', 'required'];
const ATTEMPT_LIMIT_TYPES = ['unlimited', 'one', 'max'];
const RESULT_VISIBILITIES = ['immediate', 'after_grading', 'scheduled', 'hidden'];

// Same hand-rolled approach as roleController.js's slugify — lowercase,
// non-alphanumerics collapsed to '-', trimmed.
function slugify(str) {
  return String(str)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function assertSlugAvailable(slug, excludeQuizId) {
  const filter = { 'publicAccess.slug': slug };
  if (excludeQuizId) filter._id = { $ne: excludeQuizId };
  const existing = await Quiz.findOne(filter).select('_id');
  if (existing) throw new ApiError(409, 'This public exam URL is already taken — choose a different one');
}

// Derives a candidate slug from the title when the Faculty doesn't supply
// one, appending a short random suffix so two exams titled the same don't
// collide by default (the Faculty can still edit it to something cleaner).
async function generateUniqueSlug(title) {
  const base = slugify(title) || 'exam';
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${crypto.randomBytes(3).toString('hex')}`;
    // eslint-disable-next-line no-await-in-loop
    const taken = await Quiz.findOne({ 'publicAccess.slug': candidate }).select('_id');
    if (!taken) return candidate;
  }
  return `${base}-${crypto.randomBytes(4).toString('hex')}`;
}

function assertEnum(value, allowed, label) {
  if (value !== undefined && !allowed.includes(value)) {
    throw new ApiError(400, `${label} must be one of: ${allowed.join(', ')}`);
  }
}

// Validates + assembles the `publicAccess` sub-document for create/update.
// `body` is the raw request body (examType + publicAccess), `existingQuiz`
// is the current document when updating (null on create) — used to keep the
// existing slug/passwordHash when the client doesn't send a new one.
export async function buildPublicAccessUpdate(body, existingQuiz) {
  const examType = body.examType === 'public' ? 'public' : 'course';

  if (examType !== 'public') {
    return { examType: 'course', publicAccess: { enabled: false } };
  }

  const settings = await getSettings();
  if (!settings.publicExamsEnabled) {
    throw new ApiError(400, 'Public exams are currently disabled by the site administrators');
  }

  const input = body.publicAccess || {};
  assertEnum(input.participantFields?.name, PARTICIPANT_FIELD_MODES, 'participantFields.name');
  assertEnum(input.participantFields?.email, PARTICIPANT_FIELD_MODES, 'participantFields.email');
  assertEnum(input.participantFields?.phone, PARTICIPANT_FIELD_MODES, 'participantFields.phone');
  assertEnum(input.loginRequirement, LOGIN_REQUIREMENTS, 'loginRequirement');
  assertEnum(input.attemptLimit?.type, ATTEMPT_LIMIT_TYPES, 'attemptLimit.type');
  assertEnum(input.resultSettings?.visibility, RESULT_VISIBILITIES, 'resultSettings.visibility');

  let slug = input.slug ? slugify(input.slug) : existingQuiz?.publicAccess?.slug;
  if (!slug) slug = await generateUniqueSlug(body.title || existingQuiz?.title || 'exam');
  if (slug !== existingQuiz?.publicAccess?.slug) {
    await assertSlugAvailable(slug, existingQuiz?._id);
  }

  const passwordEnabled = !!input.passwordEnabled;
  let passwordHash = existingQuiz?.publicAccess?.passwordHash || undefined;
  if (passwordEnabled) {
    if (input.password) {
      if (String(input.password).length < 4) throw new ApiError(400, 'Public exam password must be at least 4 characters');
      passwordHash = await bcrypt.hash(String(input.password), 10);
    } else if (!passwordHash) {
      throw new ApiError(400, 'A password is required when password protection is enabled');
    }
  } else {
    passwordHash = undefined;
  }

  return {
    examType: 'public',
    publicAccess: {
      enabled: input.enabled !== false,
      publicName: input.publicName || '',
      slug,
      passwordEnabled,
      passwordHash,
      participantFields: {
        name: input.participantFields?.name || existingQuiz?.publicAccess?.participantFields?.name || 'required',
        email: input.participantFields?.email || existingQuiz?.publicAccess?.participantFields?.email || 'optional',
        phone: input.participantFields?.phone || existingQuiz?.publicAccess?.participantFields?.phone || 'disabled',
      },
      loginRequirement: input.loginRequirement || existingQuiz?.publicAccess?.loginRequirement || 'guest',
      attemptLimit: {
        type: input.attemptLimit?.type || existingQuiz?.publicAccess?.attemptLimit?.type || 'one',
        max: Number(input.attemptLimit?.max) || existingQuiz?.publicAccess?.attemptLimit?.max || 1,
      },
      resultSettings: {
        visibility: input.resultSettings?.visibility || existingQuiz?.publicAccess?.resultSettings?.visibility || 'immediate',
        scheduledAt: input.resultSettings?.scheduledAt ?? existingQuiz?.publicAccess?.resultSettings?.scheduledAt ?? null,
        showScore: input.resultSettings?.showScore !== undefined ? !!input.resultSettings.showScore : existingQuiz?.publicAccess?.resultSettings?.showScore !== false,
        showPercentage: input.resultSettings?.showPercentage !== undefined ? !!input.resultSettings.showPercentage : existingQuiz?.publicAccess?.resultSettings?.showPercentage !== false,
        showPassFail: input.resultSettings?.showPassFail !== undefined ? !!input.resultSettings.showPassFail : existingQuiz?.publicAccess?.resultSettings?.showPassFail !== false,
        showCorrectAnswers: !!(input.resultSettings?.showCorrectAnswers ?? existingQuiz?.publicAccess?.resultSettings?.showCorrectAnswers),
        showExplanations: !!(input.resultSettings?.showExplanations ?? existingQuiz?.publicAccess?.resultSettings?.showExplanations),
        showQuestionByQuestion:
          input.resultSettings?.showQuestionByQuestion !== undefined
            ? !!input.resultSettings.showQuestionByQuestion
            : existingQuiz?.publicAccess?.resultSettings?.showQuestionByQuestion !== false,
      },
      disabled: !!input.disabled,
    },
  };
}

export { slugify };
