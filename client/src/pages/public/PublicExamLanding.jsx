import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock, Clock, FileQuestion, Award, GraduationCap } from 'lucide-react';
import { publicExamApi } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/format.js';

const UNAVAILABLE_MESSAGE = {
  disabled: 'This exam is currently unavailable.',
  draft: 'This exam has not been published yet.',
  scheduled: 'This exam has not started yet.',
  expired: 'This exam window has closed.',
  archived: 'This exam is no longer available.',
};

export default function PublicExamLanding() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();

  const { data, isLoading, isError } = useQuery({ queryKey: ['public-exam', slug], queryFn: () => publicExamApi.landing(slug), retry: false });
  const exam = data?.data;

  const [passwordToken, setPasswordToken] = useState(null);
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [participant, setParticipant] = useState({ name: user?.name || '', email: user?.email || '', phone: '' });
  const [starting, setStarting] = useState(false);

  if (isLoading) return <div className="max-w-2xl mx-auto px-4 py-16 text-center text-slate-400">Loading exam...</div>;
  if (isError || !exam) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Exam Not Found</h1>
        <p className="text-sm text-slate-500">This link is invalid, or the exam is no longer available.</p>
      </div>
    );
  }

  const canStart = exam.status === 'active';
  const needsPassword = exam.passwordEnabled && !passwordToken;
  const loginRequired = exam.loginRequirement === 'required' && !user;

  const submitPassword = async (e) => {
    e.preventDefault();
    setVerifying(true);
    try {
      const res = await publicExamApi.verifyPassword(slug, password);
      setPasswordToken(res.data.passwordToken || 'ok');
    } catch (err) {
      toast(err.response?.data?.message || 'Incorrect password', 'error');
    } finally {
      setVerifying(false);
    }
  };

  const start = async (e) => {
    e.preventDefault();
    setStarting(true);
    try {
      const res = await publicExamApi.start(slug, { participant, passwordToken });
      if (res.data.guestToken) localStorage.setItem(`examGuestToken:${res.data._id}`, res.data.guestToken);
      navigate(`/exam/${slug}/attempt/${res.data._id}`);
    } catch (err) {
      toast(err.response?.data?.message || 'Could not start exam', 'error');
    } finally {
      setStarting(false);
    }
  };

  const fields = exam.participantFields || {};

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10">
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center mb-6">
        <GraduationCap className="mx-auto text-brand-600 mb-3" size={32} />
        <h1 className="text-2xl font-bold text-slate-800">{exam.title}</h1>
        {exam.description && <p className="text-sm text-slate-500 mt-2">{exam.description}</p>}
        <p className="text-xs text-slate-400 mt-3">Created by {exam.createdByName}</p>

        <div className="flex flex-wrap justify-center gap-4 mt-6 text-sm text-slate-600">
          <span className="flex items-center gap-1.5"><FileQuestion size={16} className="text-brand-600" /> {exam.questionCount} Questions</span>
          <span className="flex items-center gap-1.5"><Clock size={16} className="text-brand-600" /> {exam.duration} Minutes</span>
          <span className="flex items-center gap-1.5"><Award size={16} className="text-brand-600" /> {exam.totalMarks} Marks</span>
        </div>
        <p className="text-xs text-slate-400 mt-3">Available: {formatDate(exam.startAt)} &ndash; {formatDate(exam.endAt)}</p>
      </div>

      {!canStart ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-center text-amber-800">
          {UNAVAILABLE_MESSAGE[exam.status] || 'This exam is currently unavailable.'}
        </div>
      ) : loginRequired ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-center">
          <p className="text-slate-600 mb-3">You must be logged in to take this exam.</p>
          <Link to="/login" state={{ from: { pathname: `/exam/${slug}` } }} className="inline-block px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold">
            Log In
          </Link>
        </div>
      ) : needsPassword ? (
        <form onSubmit={submitPassword} className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          <p className="flex items-center gap-1.5 text-slate-700 font-medium"><Lock size={16} /> Password Required</p>
          <input
            type="password"
            required
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter exam password"
            className="w-full h-11 rounded-lg border border-slate-300 px-3"
          />
          <button disabled={verifying} className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold disabled:opacity-60">
            {verifying ? 'Checking...' : 'Continue'}
          </button>
        </form>
      ) : (
        <form onSubmit={start} className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
          {fields.name !== 'disabled' && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Full Name {fields.name === 'required' && '*'}</label>
              <input
                required={fields.name === 'required'}
                value={participant.name}
                onChange={(e) => setParticipant((p) => ({ ...p, name: e.target.value }))}
                className="w-full h-11 rounded-lg border border-slate-300 px-3"
                placeholder="Your full name"
              />
            </div>
          )}
          {fields.email !== 'disabled' && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Email {fields.email === 'required' && '*'}</label>
              <input
                type="email"
                required={fields.email === 'required'}
                value={participant.email}
                onChange={(e) => setParticipant((p) => ({ ...p, email: e.target.value }))}
                className="w-full h-11 rounded-lg border border-slate-300 px-3"
                placeholder="you@example.com"
              />
            </div>
          )}
          {fields.phone !== 'disabled' && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Phone {fields.phone === 'required' && '*'}</label>
              <input
                required={fields.phone === 'required'}
                value={participant.phone}
                onChange={(e) => setParticipant((p) => ({ ...p, phone: e.target.value }))}
                className="w-full h-11 rounded-lg border border-slate-300 px-3"
                placeholder="Your phone number"
              />
            </div>
          )}
          <button disabled={starting} className="w-full h-11 rounded-lg bg-brand-600 text-white font-semibold disabled:opacity-60">
            {starting ? 'Starting...' : 'Start Exam'}
          </button>
        </form>
      )}
    </div>
  );
}
