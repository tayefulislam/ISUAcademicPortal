import { CheckCircle2, XCircle, Clock, EyeOff } from 'lucide-react';
import MathText from '../MathText.jsx';
import { formatDate } from '../../utils/format.js';

// Shared by the authenticated QuizResult page and the public exam result
// page. Handles both result shapes: the course-quiz view (totalScore/
// totalMarks/passed/answers) and the richer public-exam view (adds
// percentage, correctCount/incorrectCount/unansweredCount, and a
// `resultState` for hidden/pending_grading/scheduled — see
// examEngine.buildPublicResultView on the server).
export default function ResultView({ attempt }) {
  if (attempt.resultState === 'hidden') {
    return <StateCard icon={EyeOff} message="Results are not made available for this exam." />;
  }
  if (attempt.resultState === 'pending_grading') {
    return <StateCard icon={Clock} message="Your result will be available once the Faculty finishes grading." />;
  }
  if (attempt.resultState === 'scheduled') {
    return (
      <StateCard
        icon={Clock}
        message={attempt.availableAt ? `Results will be available on ${formatDate(attempt.availableAt)}.` : 'Results are not available yet.'}
      />
    );
  }

  const scoreKnown = attempt.totalScore !== undefined && attempt.totalScore !== null;

  return (
    <>
      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-6">
        {attempt.needsManualGrading ? (
          <div className="flex items-center gap-2 text-amber-700">
            <Clock size={20} /> <span>Awaiting manual grading for one or more questions.</span>
          </div>
        ) : scoreKnown ? (
          <div>
            <p className="text-3xl font-bold text-slate-800">
              {attempt.totalScore} <span className="text-lg font-normal text-slate-400">/ {attempt.totalMarks}</span>
            </p>
            {attempt.percentage !== undefined && attempt.percentage !== null && (
              <p className="text-sm text-slate-500 mt-1">{attempt.percentage}%</p>
            )}
            {attempt.passed !== undefined && (
              <span className={`inline-flex items-center gap-1 mt-2 px-2.5 py-1 rounded-full text-sm font-medium ${attempt.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                {attempt.passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />} {attempt.passed ? 'Passed' : 'Not passed'}
              </span>
            )}
            {(attempt.correctCount !== undefined || attempt.incorrectCount !== undefined || attempt.unansweredCount !== undefined) && (
              <div className="flex gap-4 mt-3 text-sm text-slate-600">
                {attempt.correctCount !== undefined && <span>Correct: <strong>{attempt.correctCount}</strong></span>}
                {attempt.incorrectCount !== undefined && <span>Incorrect: <strong>{attempt.incorrectCount}</strong></span>}
                {attempt.unansweredCount !== undefined && <span>Unanswered: <strong>{attempt.unansweredCount}</strong></span>}
              </div>
            )}
          </div>
        ) : (
          <p className="text-slate-500">Your result will be shown once available.</p>
        )}
      </div>

      {attempt.answers?.length > 0 && (
        <div className="space-y-3">
          {attempt.answers.map((a, i) => (
            <div key={a.question} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <MathText text={`${i + 1}. ${a.questionText}`} className="text-slate-700 font-medium" />
                {a.isCorrect !== undefined && a.isCorrect !== null && (
                  a.isCorrect ? <CheckCircle2 className="text-emerald-500 shrink-0" size={18} /> : <XCircle className="text-red-500 shrink-0" size={18} />
                )}
              </div>
              {a.marksAwarded !== undefined && <p className="text-xs text-slate-400 mt-1">Marks: {a.marksAwarded ?? '-'}</p>}
              <CorrectAnswer answer={a} />
              {a.explanation && <p className="text-sm text-slate-500 mt-2 bg-slate-50 rounded-lg p-2">{a.explanation}</p>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function StateCard({ icon: Icon, message }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
      <Icon className="mx-auto text-slate-400 mb-2" size={28} />
      <p className="text-slate-500">{message}</p>
    </div>
  );
}

// Renders the actual correct-answer content for each question type — the
// previously-existing course-quiz result page only checked whether this
// data was *present* to decide if a section should render, but never
// rendered the answer itself.
function CorrectAnswer({ answer: a }) {
  if (a.correctOptionIds !== undefined) {
    const correctTexts = (a.options || []).filter((o) => a.correctOptionIds.some((id) => String(id) === String(o._id))).map((o) => o.text);
    if (!correctTexts.length) return null;
    return (
      <p className="text-xs text-emerald-700 mt-2">
        Correct answer: <MathText text={correctTexts.join(', ')} className="inline" />
      </p>
    );
  }
  if (a.correctTextAnswers?.length) {
    return <p className="text-xs text-emerald-700 mt-2">Correct answer: {a.correctTextAnswers.join(', ')}</p>;
  }
  if (a.correctMatchingPairs?.length) {
    return (
      <p className="text-xs text-emerald-700 mt-2">
        Correct matches: {a.correctMatchingPairs.map((p) => `${p.left} → ${p.right}`).join('; ')}
      </p>
    );
  }
  if (a.correctNumericalAnswer !== undefined && a.correctNumericalAnswer !== null) {
    return <p className="text-xs text-emerald-700 mt-2">Correct answer: {a.correctNumericalAnswer}</p>;
  }
  return null;
}
