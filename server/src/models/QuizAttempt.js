import mongoose from 'mongoose';

export const ATTEMPT_STATUSES = ['in_progress', 'submitted', 'graded'];

// One flexible answer shape covers every question type rather than a
// separate sub-schema per type — simpler to autosave/grade generically.
const answerSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
    selectedOptionIds: [{ type: mongoose.Schema.Types.ObjectId }], // mcq / multi_select / true_false
    textAnswers: [{ type: String }], // short_answer (1) / fill_blank (1 per blank)
    numericalAnswer: { type: Number, default: null },
    matchingAnswer: [{ left: String, right: String }],
    markedForReview: { type: Boolean, default: false },
    marksAwarded: { type: Number, default: null }, // filled by auto-grade or manual grade
    isCorrect: { type: Boolean, default: null }, // auto-graded types only
  },
  { _id: false }
);

const quizAttemptSchema = new mongoose.Schema(
  {
    quiz: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', required: true },
    // Optional only for a guest public-exam attempt — every attempt ever
    // created before `isGuestAttempt` existed already has `student` set, so
    // relaxing `required:true` to conditional changes nothing for them.
    student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: function () { return !this.isGuestAttempt; } },
    attemptNumber: { type: Number, required: true },

    // ----- Public/guest exam fields (all unused, defaulted, for a course-quiz attempt) -----
    isGuestAttempt: { type: Boolean, default: false },
    participant: {
      name: { type: String, default: '' },
      email: { type: String, default: '' },
      phone: { type: String, default: '' },
    },
    // Returned once to the guest at start, stored hashed-nowhere (it's a
    // random bearer token, not a secret derived from anything guessable) —
    // select:false so a generic `find()` never carries it back out.
    guestToken: { type: String, select: false },
    ipAddress: { type: String, default: '' },
    userAgent: { type: String, default: '' },

    // Snapshot of question order (and, if randomizeOptions, option order per
    // question) generated once at start — so a resumed/refreshed attempt
    // sees the exact same layout instead of re-shuffling every load.
    questionOrder: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
    optionOrder: { type: Map, of: [mongoose.Schema.Types.ObjectId], default: undefined }, // questionId -> shuffled option ids
    // questionId -> marks assigned to THIS attempt, set once at creation for
    // both fixed and random-selection exams. Absent on attempts created
    // before this field existed — every read path falls back to the quiz's
    // fixed `questions[].marks` list in that case (examEngine.marksFor).
    assignedMarks: { type: Map, of: Number, default: undefined },

    answers: [answerSchema],

    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },

    autoScore: { type: Number, default: 0 },
    manualScore: { type: Number, default: 0 },
    totalScore: { type: Number, default: null }, // null until every question is graded
    needsManualGrading: { type: Boolean, default: false },

    status: { type: String, enum: ATTEMPT_STATUSES, default: 'in_progress' },
    gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    gradedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

quizAttemptSchema.index({ quiz: 1, student: 1 });
quizAttemptSchema.index({ student: 1 });
quizAttemptSchema.index({ status: 1 });
quizAttemptSchema.index({ guestToken: 1 }, { sparse: true });
quizAttemptSchema.index({ quiz: 1, 'participant.email': 1 }, { sparse: true });

export default mongoose.model('QuizAttempt', quizAttemptSchema);
