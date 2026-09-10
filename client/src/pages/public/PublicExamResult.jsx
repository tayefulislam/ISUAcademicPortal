import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { publicExamApi } from '../../api/endpoints.js';
import ResultView from '../../components/exam/ResultView.jsx';

export default function PublicExamResult() {
  const { slug, attemptId } = useParams();
  const guestToken = localStorage.getItem(`examGuestToken:${attemptId}`);
  const { data, isLoading } = useQuery({
    queryKey: ['public-exam-result', attemptId],
    queryFn: () => publicExamApi.result(slug, attemptId, guestToken),
  });
  const attempt = data?.data;

  if (isLoading) return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-slate-400">Loading result...</div>;
  if (!attempt) return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-slate-400">Attempt not found.</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Exam Result</h1>
      {attempt.participant?.name && <p className="text-sm text-slate-500 mb-6">Participant: {attempt.participant.name}</p>}

      <ResultView attempt={attempt} />

      <Link to={`/exam/${slug}`} className="inline-block mt-6 text-brand-600 hover:underline text-sm">&larr; Back to exam</Link>
    </div>
  );
}
