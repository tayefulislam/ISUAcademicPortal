import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { quizApi } from '../api/endpoints.js';

// Target of the EXAM_RESULT notification's link (see
// notificationTemplates.js's `url: (v) => \`/student/results/${v.attemptId}\``)
// — deliberately a clean, quiz-id-free URL so the notification payload only
// ever needs to carry the attempt id, not a `(quizId, attemptId)` pair. The
// real result page (QuizResult.jsx) is mounted at
// /quizzes/:id/result/:attemptId and does need the quiz id, so this page's
// only job is to resolve attemptId -> its quiz via the student's own
// attempts list (a student can only ever end up here for their own attempt)
// and hand off to that real route.
export default function StudentResultRedirect() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useQuery({ queryKey: ['my-attempts'], queryFn: quizApi.myAttempts });

  const attempt = (data?.data || []).find((a) => a._id === attemptId);

  useEffect(() => {
    if (attempt?.quiz?._id) {
      navigate(`/quizzes/${attempt.quiz._id}/result/${attemptId}`, { replace: true });
    }
  }, [attempt, attemptId, navigate]);

  if (isLoading) {
    return <div className="max-w-2xl mx-auto px-4 py-16 text-center text-slate-400">Loading result...</div>;
  }
  if (isError || !attempt) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Result Not Found</h1>
        <p className="text-sm text-slate-500">This result link is invalid, or it isn&apos;t one of your own attempts.</p>
      </div>
    );
  }
  return <div className="max-w-2xl mx-auto px-4 py-16 text-center text-slate-400">Redirecting...</div>;
}
