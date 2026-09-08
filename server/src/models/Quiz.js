import mongoose from 'mongoose';

export const QUIZ_STATUSES = ['draft', 'published', 'closed'];

const quizSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },

    // Targeting — identical AND-across-axes/OR-within-axis semantics to
    // Assignment: reaches exactly the intersection of the groups picked.
    departments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Department' }],
    courses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
    batches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Batch' }],
    semesters: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Semester' }],

    // Each entry references a bank Question, with a per-quiz marks override
    // and display order (independent of randomizeQuestions, which shuffles
    // at attempt-start time without touching this stored order).
    questions: [
      {
        question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
        marks: { type: Number, required: true, min: 0 },
        order: { type: Number, default: 0 },
      },
    ],
    totalMarks: { type: Number, default: 0 }, // derived, recomputed on save

    // 'fixed' (the only behavior that existed before this field): use the
    // hand-curated `questions` list above, exactly as always. 'random':
    // `questions` is ignored — each attempt samples fresh questions from
    // the bank per `rules` at start time (see examEngine.generateAttemptSnapshot)
    // and snapshots exactly what it picked onto the attempt, so two
    // participants can get different questions and a later bank edit never
    // touches an already-taken attempt.
    questionSelection: {
      mode: { type: String, enum: ['fixed', 'random'], default: 'fixed' },
      rules: [
        {
          course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
          difficulty: { type: String, enum: ['easy', 'medium', 'hard', 'any'], default: 'any' },
          tags: [{ type: String, trim: true, lowercase: true }],
          count: { type: Number, required: true, min: 1 },
          marksEach: { type: Number, required: true, min: 0 },
        },
      ],
    },

    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    duration: { type: Number, required: true, min: 1 }, // minutes, per attempt

    passingMarks: { type: Number, default: 0 },
    attemptsAllowed: { type: Number, default: 1, min: 1 },
    randomizeQuestions: { type: Boolean, default: false },
    randomizeOptions: { type: Boolean, default: false },
    showResultImmediately: { type: Boolean, default: true },
    showCorrectAnswers: { type: Boolean, default: false },
    negativeMarking: {
      enabled: { type: Boolean, default: false },
      valuePerWrong: { type: Number, default: 0, min: 0 }, // marks deducted per wrong auto-graded answer
    },

    status: { type: String, enum: QUIZ_STATUSES, default: 'draft' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    // 'course' (the only behavior that existed before this field) is an
    // authenticated quiz reached via department/course/batch/semester
    // targeting, same as always. 'public' is reachable by anyone via
    // `publicAccess.slug`'s shareable URL — no targeting, optional guest
    // access. Every field below defaults such that an existing document
    // (examType absent, publicAccess.enabled absent) behaves exactly as it
    // did before this field existed.
    examType: { type: String, enum: ['course', 'public'], default: 'course' },
    publicAccess: {
      enabled: { type: Boolean, default: false },
      publicName: { type: String, default: '' }, // falls back to `title` when empty
      slug: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
      passwordEnabled: { type: Boolean, default: false },
      passwordHash: { type: String, select: false },
      participantFields: {
        name: { type: String, enum: ['required', 'optional', 'disabled'], default: 'required' },
        email: { type: String, enum: ['required', 'optional', 'disabled'], default: 'optional' },
        phone: { type: String, enum: ['required', 'optional', 'disabled'], default: 'disabled' },
      },
      loginRequirement: { type: String, enum: ['guest', 'optional', 'required'], default: 'guest' },
      attemptLimit: {
        type: { type: String, enum: ['unlimited', 'one', 'max'], default: 'one' },
        max: { type: Number, default: 1, min: 1 },
      },
      resultSettings: {
        visibility: { type: String, enum: ['immediate', 'after_grading', 'scheduled', 'hidden'], default: 'immediate' },
        scheduledAt: { type: Date, default: null },
        showScore: { type: Boolean, default: true },
        showPercentage: { type: Boolean, default: true },
        showPassFail: { type: Boolean, default: true },
        showCorrectAnswers: { type: Boolean, default: false },
        showExplanations: { type: Boolean, default: false },
        showQuestionByQuestion: { type: Boolean, default: true },
      },
      // Lets Faculty immediately pull a public exam offline without
      // touching `status` (which also governs the authenticated flow).
      disabled: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

quizSchema.pre('save', function recomputeTotalMarks(next) {
  this.totalMarks =
    this.questionSelection?.mode === 'random'
      ? (this.questionSelection.rules || []).reduce((sum, r) => sum + r.count * r.marksEach, 0)
      : (this.questions || []).reduce((sum, q) => sum + (q.marks || 0), 0);
  next();
});

quizSchema.index({ status: 1 });
quizSchema.index({ departments: 1 });
quizSchema.index({ courses: 1 });
quizSchema.index({ batches: 1 });
quizSchema.index({ semesters: 1 });
quizSchema.index({ createdBy: 1 });
quizSchema.index({ startAt: 1, endAt: 1 });

export default mongoose.model('Quiz', quizSchema);
