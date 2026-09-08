import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap } from 'lucide-react';
import { quizApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { formatDate } from '../utils/format.js';

const STATUS_STYLE = { draft: 'bg-slate-100 text-slate-600', published: 'bg-emerald-50 text-emerald-700', closed: 'bg-red-50 text-red-600' };

export default function Quizzes() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery({ queryKey: ['quizzes'], queryFn: quizApi.list, retry: false });
  const quizzes = data?.data || [];

  const start = async (quiz) => {
    try {
      const res = await quizApi.start(quiz._id);
      navigate(`/quizzes/${quiz._id}/attempt/${res.data._id}`);
    } catch (err) {
      toast(err.response?.data?.message || 'Could not start quiz', 'error');
    }
  };

  if (isError) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Quizzes Unavailable</h1>
        <p className="text-sm text-slate-500">The quiz system is currently turned off by the site administrators.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-2 mb-1">
        <GraduationCap className="text-brand-600" size={22} />
        <h1 className="text-2xl font-bold text-slate-800">Quizzes</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">Quizzes targeted to your department, course, batch, and semester.</p>

      {isLoading ? (
        <p className="text-slate-400">Loading...</p>
      ) : quizzes.length === 0 ? (
        <p className="text-slate-400">No quizzes right now.</p>
      ) : (
        <div className="space-y-3">
          {quizzes.map((q) => {
            const now = new Date();
            const inWindow = new Date(q.startAt) <= now && now <= new Date(q.endAt);
            const attemptsUsed = q.myAttempts?.length || 0;
            const canAttempt = q.status === 'published' && inWindow && attemptsUsed < q.attemptsAllowed;
            const inProgress = q.myAttempts?.find((a) => a.status === 'in_progress');
            const lastGraded = q.myAttempts?.filter((a) => a.status === 'graded').slice(-1)[0];

            return (
              <div key={q._id} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-700">{q.title}</p>
                    <p className="text-sm text-slate-600 mt-0.5">{q.description}</p>
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[q.status]}`}>{q.status}</span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  {formatDate(q.startAt)} – {formatDate(q.endAt)} &middot; {q.duration} min &middot; {attemptsUsed}/{q.attemptsAllowed} attempts used
                </p>

                <div className="flex items-center justify-between mt-3">
                  {lastGraded ? (
                    <span className="text-sm text-emerald-700">
                      {lastGraded.totalScore !== null ? `Score: ${lastGraded.totalScore}` : 'Awaiting grading'}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">Not attempted</span>
                  )}

                  <div className="flex items-center gap-2">
                    {lastGraded && (
                      <button
                        onClick={() => navigate(`/quizzes/${q._id}/result/${lastGraded._id}`)}
                        className="px-3 py-1.5 rounded-md border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50"
                      >
                        View Result
                      </button>
                    )}
                    {inProgress ? (
                      <button onClick={() => navigate(`/quizzes/${q._id}/attempt/${inProgress._id}`)} className="px-3 py-1.5 rounded-md bg-amber-500 text-white text-sm font-medium hover:bg-amber-600">
                        Resume
                      </button>
                    ) : canAttempt ? (
                      <button onClick={() => start(q)} className="px-3 py-1.5 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
                        Start
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
