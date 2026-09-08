import mongoose from 'mongoose';

export const QUESTION_TYPES = [
  'mcq',
  'multi_select',
  'true_false',
  'short_answer',
  'long_answer',
  'fill_blank',
  'matching',
  'numerical',
];

// Types the backend can score automatically on submit — everything else
// (long_answer) always needs a human grade.
export const AUTO_GRADABLE_TYPES = ['mcq', 'multi_select', 'true_false', 'short_answer', 'fill_blank', 'matching', 'numerical'];

const optionSchema = new mongoose.Schema(
  {
    text: { type: String, trim: true },
    imageUrl: { type: String, default: '' },
    isCorrect: { type: Boolean, default: false },
  },
  { _id: true }
);

// Question text/explanation is plain text with LaTeX delimiters ($...$ inline,
// $$...$$ display) — rendered client-side via KaTeX (see MathText.jsx). This
// avoids shipping a full WYSIWYG editor while still meeting "insert/edit
// equations without writing HTML by hand": the editor just has snippet
// buttons that insert LaTeX into the textarea, and a live preview.
const questionSchema = new mongoose.Schema(
  {
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
    chapter: { type: mongoose.Schema.Types.ObjectId, ref: 'Chapter', default: null },
    topic: { type: mongoose.Schema.Types.ObjectId, ref: 'Topic', default: null },

    type: { type: String, enum: QUESTION_TYPES, required: true },
    text: { type: String, required: true, trim: true },
    imageUrl: { type: String, default: '' },
    imageStorageProvider: { type: String, default: '' },
    imageStorageRef: { type: String, default: '' },

    // mcq / multi_select / true_false
    options: [optionSchema],

    // short_answer / fill_blank — any of these (case-insensitive, trimmed)
    // counts as correct; fill_blank with multiple blanks stores one accepted
    // answer per blank, in order.
    correctTextAnswers: [{ type: String, trim: true }],

    // matching
    matchingPairs: [{ left: { type: String, trim: true }, right: { type: String, trim: true } }],

    // numerical
    numericalAnswer: { type: Number, default: null },
    numericalTolerance: { type: Number, default: 0 },

    explanation: { type: String, default: '' }, // shown with the correct answer, optional
    defaultMarks: { type: Number, default: 1, min: 0 },

    // Used by an exam's random "pick N by difficulty/tag" question
    // selection (see Quiz.questionSelection) and for Question Bank
    // filtering — optional metadata, defaulted so every existing question
    // is unaffected.
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'medium' },
    tags: [{ type: String, trim: true, lowercase: true }],
    // 0 (default) means "use the quiz's flat negativeMarking.valuePerWrong,
    // exactly as before this field existed" — a positive value overrides
    // that flat value for this specific question only.
    negativeMarks: { type: Number, default: 0, min: 0 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },

    // 'private' (default): only the creator (and Super Admin) can see or use
    // this question. 'public': any Faculty/Admin can see it and add it to
    // their own quizzes, but editing/deleting still stays creator-only
    // (or Super Admin) regardless of visibility — sharing is not co-ownership.
    visibility: { type: String, enum: ['public', 'private'], default: 'private' },
  },
  { timestamps: true }
);

questionSchema.index({ department: 1, course: 1 });
questionSchema.index({ chapter: 1 });
questionSchema.index({ topic: 1 });
questionSchema.index({ createdBy: 1 });
questionSchema.index({ type: 1 });
questionSchema.index({ visibility: 1 });
questionSchema.index({ difficulty: 1 });
questionSchema.index({ tags: 1 });

export default mongoose.model('Question', questionSchema);
