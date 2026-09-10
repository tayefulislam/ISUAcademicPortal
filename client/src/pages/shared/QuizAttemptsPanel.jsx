import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, BarChart3, Download } from 'lucide-react';
import { quizApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/format.js';
import MathText from '../../components/MathText.jsx';

const STATUS_STYLE = { in_progress: 'bg-slate-100 text-slate-600', submitted: 'bg-amber-50 text-amber-700', graded: 'bg-emerald-50 text-emerald-700' };

export default function QuizAttemptsPanel({ quiz, onClose }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState('attempts');
  const [grades, setGrades] = useState({});

  const { data, isLoading } = useQuery({ queryKey: ['quiz-attempts', quiz._id], queryFn: () => quizApi.listAttempts(quiz._id) });
  const { data: analyticsData } = useQuery({ queryKey: ['quiz-analytics', quiz._id], queryFn: () => quizApi.analytics(quiz._id), enabled: tab === 'analytics' });

  const attempts = data?.data || [];
  const analytics = analyticsData?.data;

  const longAnswerQuestions = quiz.questions?.filter((q) => q.question?.type === 'long_answer' || q.type === 'long_answer') || [];

  const setGrade = (attemptId, questionId, marks) =>
    setGrades((g) => ({ ...g, [attemptId]: { ...g[attemptId], [questionId]: marks } }));

  const submitGrades = async (attempt) => {
    const g = grades[attempt._id];
    if (!g) return toast('Enter marks first', 'error');
    const gradesArr = Object.entries(g).map(([questionId, marksAwarded]) => ({ questionId, marksAwarded: Number(marksAwarded) }));
    try {
      await quizApi.gradeAttempt(quiz._id, attempt._id, { grades: gradesArr });
      toast('Graded', 'success');
      qc.invalidateQueries({ queryKey: ['quiz-attempts', quiz._id] });
    } catch (err) {
      toast(err.response?.data?.message || 'Grading failed', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-4xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800">{quiz.title} — Attempts</h2>
          <div className="flex items-center gap-2 shrink-0">
            {tab === 'attempts' && attempts.length > 0 && (
              <button
                onClick={() => quizApi.exportAttempts(quiz._id)}
                className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50"
              >
                <Download size={15} /> Export CSV
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100"><X size={18} /></button>
          </div>
        </div>

        <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit mb-4">
          <button onClick={() => setTab('attempts')} className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === 'attempts' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>Attempts</button>
          <button onClick={() => setTab('analytics')} className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === 'analytics' ? 'bg-white shadow-sm' : 'text-slate-500'}`}>Analytics</button>
        </div>

        {tab === 'attempts' ? (
          isLoading ? (
            <p className="text-slate-400">Loading...</p>
          ) : attempts.length === 0 ? (
            <p className="text-slate-400">No attempts yet.</p>
          ) : (
            <div className="space-y-3">
              {attempts.map((a) => (
                <div key={a._id} className="border border-slate-200 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-700">
                        {a.isGuestAttempt ? a.participant?.name || 'Guest' : a.student?.name}{' '}
                        <span className="text-xs text-slate-400">(attempt {a.attemptNumber})</span>
                        {a.isGuestAttempt && <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-sky-50 text-sky-700 align-middle">Guest</span>}
                      </p>
                      {a.isGuestAttempt ? (
                        <p className="text-xs text-slate-500">{a.participant?.email || 'No email provided'}{a.participant?.phone && <> &middot; {a.participant.phone}</>}</p>
                      ) : (
                        <p className="text-xs text-slate-500">{a.student?.email} &middot; Roll {a.student?.rollNo || '-'} &middot; {a.student?.department?.code} &middot; {a.student?.batch?.name}</p>
                      )}
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[a.status]}`}>{a.status}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Started {formatDate(a.startedAt)} {a.submittedAt && <>&middot; Submitted {formatDate(a.submittedAt)}</>}</p>
                  {a.status === 'graded' && <p className="text-sm text-emerald-700 mt-2">Score: {a.totalScore}/{quiz.totalMarks}</p>}

                  {a.status === 'submitted' && a.needsManualGrading && longAnswerQuestions.length > 0 && (
                    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                      {longAnswerQuestions.map((lq) => {
                        const qId = lq.question?._id || lq.question;
                        const answer = a.answers?.find((ans) => String(ans.question) === String(qId));
                        return (
                          <div key={qId} className="text-sm">
                            <MathText text={lq.question?.text || ''} className="text-slate-600" />
                            <p className="text-slate-500 bg-slate-50 rounded p-2 mt-1 whitespace-pre-wrap">{answer?.textAnswers?.[0] || '(no answer)'}</p>
                            <div className="flex items-center gap-2 mt-1">
                              <input
                                type="number"
                                min={0}
                                max={lq.marks}
                                placeholder={`/ ${lq.marks}`}
                                value={grades[a._id]?.[qId] ?? ''}
                                onChange={(e) => setGrade(a._id, qId, e.target.value)}
                                className="w-20 h-8 rounded border border-slate-300 px-2 text-sm"
                              />
                            </div>
                          </div>
                        );
                      })}
                      <button onClick={() => submitGrades(a)} className="h-8 px-3 rounded-lg bg-brand-600 text-white text-sm font-medium">Save Grades</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        ) : (
          <div>
            {!analytics ? (
              <p className="text-slate-400">Loading...</p>
            ) : (
              <div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                  <Stat label="Attempts" value={analytics.totalAttempts} />
                  <Stat label="Graded" value={analytics.gradedAttempts} />
                  <Stat label="Avg Score" value={analytics.averageScore ?? '-'} />
                  <Stat label="Passed" value={analytics.passCount} />
                </div>
                {analytics.totalParticipants !== undefined && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    <Stat label="Total Participants" value={analytics.totalParticipants} />
                    <Stat label="Guests" value={analytics.guestParticipants} />
                    <Stat label="Logged-in" value={analytics.loggedInParticipants} />
                    <Stat label="Completed" value={analytics.completedAttempts} />
                  </div>
                )}
                <div className="space-y-2">
                  {analytics.questionStats.map((q) => (
                    <div key={q.questionId} className="border border-slate-200 rounded-lg p-3">
                      <MathText text={q.text} className="text-sm text-slate-700" />
                      <p className="text-xs text-slate-400 mt-1">{q.type} &middot; {q.marks} marks</p>
                      <div className="flex gap-3 mt-1 text-xs">
                        <span className="text-emerald-600">{q.correct} correct</span>
                        <span className="text-red-600">{q.incorrect} incorrect</span>
                        <span className="text-slate-400">{q.unanswered} unanswered</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3 text-center">
      <p className="text-xl font-bold text-slate-800">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}
