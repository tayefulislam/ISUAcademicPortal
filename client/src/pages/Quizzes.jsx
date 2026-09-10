import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { GraduationCap, Clock } from 'lucide-react';
import { quizApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { useCountdownTo } from '../components/exam/useCountdown.js';
import { formatBST } from '../utils/format.js';

const STATUS_STYLE = { draft: 'bg-slate-100 text-slate-600', published: 'bg-emerald-50 text-emerald-700', closed: 'bg-red-50 text-red-600' };

export default function Quizzes() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery({ queryKey: ['quizzes'], queryFn: quizApi.list, retry: false });
  const quizzes = data?.data || [];
  const blockedByApproval = !!data?.blockedByApproval;

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
      ) : blockedByApproval ? (
        <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-4">
          Quizzes unlock once an Admin approves your Student ID.
        </p>
      ) : quizzes.length === 0 ? (
        <p className="text-slate-400">No quizzes right now.</p>
      ) : (
        <div className="space-y-3">
          {quizzes.map((q) => (
            <QuizCard key={q._id} q={q} onStart={start} navigate={navigate} />
          ))}
        </div>
      )}
    </div>
  );
}

// Split out from Quizzes so the live "Starts in ..." countdown only
// re-renders its own card once a second, not the entire list — the
// countdown hook's internal tick (see useCountdownTo) is what re-evaluates
// `inWindow`/`canAttempt` below on each tick, flipping to the Start button
// the instant the window opens with no refetch needed (nothing about the
// window opening depends on server state beyond the startAt/endAt already
// in hand).
function QuizCard({ q, onStart, navigate }) {
  const now = new Date();
  const startAt = new Date(q.startAt);
  const endAt = new Date(q.endAt);
  const inWindow = startAt <= now && now <= endAt;
  const notStartedYet = q.status === 'published' && now < startAt;
  const attemptsUsed = q.myAttempts?.length || 0;
  const canAttempt = q.status === 'published' && inWindow && attemptsUsed < q.attemptsAllowed;
  const inProgress = q.myAttempts?.find((a) => a.status === 'in_progress');
  const lastGraded = q.myAttempts?.filter((a) => a.status === 'graded').slice(-1)[0];

  const { label: startsInLabel } = useCountdownTo(notStartedYet ? q.startAt : null);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-slate-700">{q.title}</p>
          <p className="text-sm text-slate-600 mt-0.5">{q.description}</p>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[q.status]}`}>{q.status}</span>
      </div>
      <p className="text-xs text-slate-400 mt-2">
        {formatBST(q.startAt)} – {formatBST(q.endAt)} &middot; {q.duration} min &middot; {attemptsUsed}/{q.attemptsAllowed} attempts used
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
            <button onClick={() => onStart(q)} className="px-3 py-1.5 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700">
              Start
            </button>
          ) : notStartedYet ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1.5 rounded-md font-mono" title={`Opens ${formatBST(q.startAt)}`}>
              <Clock size={13} /> Starts in {startsInLabel}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
