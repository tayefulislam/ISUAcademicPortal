import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate, useBeforeUnload } from 'react-router-dom';
import { Flag, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { quizApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import MathText from '../components/MathText.jsx';
import AnswerInput from '../components/exam/AnswerInput.jsx';
import { useCountdown } from '../components/exam/useCountdown.js';
import { trackClarityEvent } from '../analytics/clarity.js';

export default function QuizAttempt() {
  const { id: quizId, attemptId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [attempt, setAttempt] = useState(null);
  const [answers, setAnswers] = useState({}); // questionId -> answer state
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // In-app confirmation instead of window.confirm() — the native dialog is a
  // known silent no-op (returns undefined, never actually prompts) when this
  // app is running as an installed PWA in standalone display mode on iOS
  // Safari, which made "Submit Quiz" appear completely dead on those devices.
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const saveTimers = useRef({});

  useEffect(() => {
    quizApi
      .getAttempt(quizId, attemptId)
      .then((res) => {
        if (res.data.status !== 'in_progress') {
          navigate(`/quizzes/${quizId}/result/${attemptId}`, { replace: true });
          return;
        }
        setAttempt(res.data);
        const byQ = {};
        for (const a of res.data.answers || []) byQ[a.question] = a;
        setAnswers(byQ);
        setLoading(false);
        trackClarityEvent('quiz_started');
      })
      .catch((err) => {
        toast(err.response?.data?.message || 'Could not load attempt', 'error');
        navigate('/quizzes');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId, attemptId]);

  useBeforeUnload(
    useCallback((e) => {
      e.preventDefault();
      e.returnValue = '';
    }, [])
  );

  const doSubmit = useCallback(
    async (silent) => {
      setSubmitting(true);
      try {
        const res = await quizApi.submitAttempt(quizId, attemptId);
        trackClarityEvent('quiz_submitted');
        if (!silent) toast('Quiz submitted', 'success');
        navigate(`/quizzes/${quizId}/result/${attemptId}`, { replace: true });
        return res;
      } catch (err) {
        toast(err.response?.data?.message || 'Submit failed', 'error');
        setSubmitting(false);
      }
    },
    [quizId, attemptId, navigate, toast]
  );

  const { label: timeLabel, low: timeLow } = useCountdown(attempt?.deadlineAt || null, () => doSubmit(true));

  const saveAnswer = (questionId, patch) => {
    setAnswers((prev) => ({ ...prev, [questionId]: { ...prev[questionId], question: questionId, ...patch } }));
    clearTimeout(saveTimers.current[questionId]);
    saveTimers.current[questionId] = setTimeout(async () => {
      try {
        await quizApi.saveAnswer(quizId, attemptId, { questionId, ...answers[questionId], ...patch });
      } catch (err) {
        if (err.response?.data?.autoSubmitted) {
          toast('Time is up — your quiz was auto-submitted', 'error');
          navigate(`/quizzes/${quizId}/result/${attemptId}`, { replace: true });
        }
      }
    }, 500);
  };

  if (loading || !attempt) {
    return <div className="max-w-5xl mx-auto px-4 py-16 text-center text-slate-400">Loading quiz...</div>;
  }

  const questions = attempt.questions;
  const question = questions[current];
  const answer = answers[question._id] || { question: question._id };

  const statusFor = (q) => {
    const a = answers[q._id];
    if (!a) return 'unanswered';
    if (a.markedForReview) return 'marked';
    const answered = a.selectedOptionIds?.length || a.textAnswers?.some(Boolean) || a.numericalAnswer !== null && a.numericalAnswer !== undefined || a.matchingAnswer?.length;
    return answered ? 'answered' : 'unanswered';
  };

  const answeredCount = questions.filter((q) => statusFor(q) === 'answered').length;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 sticky top-0 bg-slate-50 py-2 z-10">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Attempt in progress</h1>
          <p className="text-xs text-slate-500">{answeredCount}/{questions.length} answered</p>
        </div>
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-mono font-semibold ${timeLow ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-700'}`}>
          <Clock size={16} /> {timeLabel}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-slate-400">Question {current + 1} of {questions.length} &middot; {question.marks} marks</span>
            <button
              onClick={() => saveAnswer(question._id, { markedForReview: !answer.markedForReview })}
              className={`flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${answer.markedForReview ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-slate-300 text-slate-500'}`}
            >
              <Flag size={12} /> {answer.markedForReview ? 'Marked' : 'Mark for review'}
            </button>
          </div>

          <MathText text={question.text} className="text-slate-800 font-medium" />
          {question.imageUrl && <img src={question.imageUrl} alt="" className="max-h-64 rounded-lg mt-3" />}

          <div className="mt-5">
            <AnswerInput question={question} answer={answer} onChange={(patch) => saveAnswer(question._id, patch)} />
          </div>

          <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
            <button
              onClick={() => setCurrent((c) => Math.max(0, c - 1))}
              disabled={current === 0}
              className="flex items-center gap-1 px-3 py-2 rounded-lg border border-slate-300 text-sm disabled:opacity-40"
            >
              <ChevronLeft size={16} /> Previous
            </button>
            {current < questions.length - 1 ? (
              <button onClick={() => setCurrent((c) => c + 1)} className="flex items-center gap-1 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium">
                Save & Next <ChevronRight size={16} />
              </button>
            ) : (
              <button
                disabled={submitting}
                onClick={() => setConfirmingSubmit(true)}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-60"
              >
                {submitting ? 'Submitting...' : 'Submit Quiz'}
              </button>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 h-fit">
          <p className="text-xs font-semibold text-slate-500 mb-2">Questions</p>
          <div className="grid grid-cols-5 lg:grid-cols-4 gap-2">
            {questions.map((q, i) => {
              const status = statusFor(q);
              const style =
                status === 'answered'
                  ? 'bg-emerald-500 text-white'
                  : status === 'marked'
                  ? 'bg-amber-400 text-white'
                  : 'bg-slate-100 text-slate-600';
              return (
                <button key={q._id} onClick={() => setCurrent(i)} className={`h-9 rounded-md text-xs font-medium ${style} ${current === i ? 'ring-2 ring-brand-600' : ''}`}>
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className="mt-3 space-y-1 text-xs text-slate-500">
            <p><span className="inline-block w-3 h-3 rounded bg-emerald-500 mr-1.5" /> Answered</p>
            <p><span className="inline-block w-3 h-3 rounded bg-amber-400 mr-1.5" /> Marked for review</p>
            <p><span className="inline-block w-3 h-3 rounded bg-slate-100 mr-1.5" /> Unanswered</p>
          </div>
          <button
            disabled={submitting}
            onClick={() => setConfirmingSubmit(true)}
            className="w-full mt-4 h-9 rounded-lg bg-emerald-600 text-white text-sm font-medium disabled:opacity-60"
          >
            Submit Quiz
          </button>
        </div>
      </div>

      {confirmingSubmit && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setConfirmingSubmit(false)}>
          <div className="bg-white rounded-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-800 mb-2">Submit the quiz?</h2>
            <p className="text-sm text-slate-500 mb-5">You cannot change your answers after this.</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmingSubmit(false)} className="flex-1 h-10 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => {
                  setConfirmingSubmit(false);
                  doSubmit(false);
                }}
                className="flex-1 h-10 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
