import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { ShieldAlert, ShieldCheck, User as UserIcon, LogOut, UploadCloud } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { studentIdApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';

// Landing page for a student who still needs Student ID verification, or
// whose submission was rejected. Dashboard.jsx redirects here instead of
// rendering itself for exactly that case. An official-university-email
// student never lands here at all — their account is auto-approved the
// moment their email is verified (see authController.js's
// maybeAutoApproveStudent) — so every state this page handles implies
// Student ID verification genuinely applies to this account. If an already-
// approved account somehow loads this page directly (a stale link, back-
// button, etc.), it redirects straight to the dashboard rather than showing
// stale "pending" copy.
export default function PendingApproval() {
  const { user, logout, updateUser } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [file, setFile] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(''); // '' | 'uploading' | 'processing' | 'saving'

  // Cleared whenever the account state changes out from under this page
  // (e.g. rejected -> resubmitted -> pending) so a stale file selection
  // from a previous round doesn't linger in the input.
  useEffect(() => {
    setFile(null);
  }, [user?.approvalStatus]);

  // `nextStep` (registrationFlowService.js's getNextRequiredStep, attached
  // to the cached user by every auth response) is DASHBOARD once nothing is
  // left to do — covers plain approvalStatus==='approved' plus every other
  // case that also resolves to "nothing required" (non-student roles,
  // Student ID not required at all, etc).
  if (user?.nextStep === 'DASHBOARD') {
    return <Navigate to="/dashboard" replace />;
  }

  const rejected = user?.approvalStatus === 'rejected';
  // Registration no longer collects a Student ID photo — a 'pending'
  // student may or may not have submitted one yet. `studentIdImage` is the
  // (sanitized, key-stripped) subdocument from toSafeObject(); its
  // `provider` is only ever set once an image actually exists on file.
  const hasSubmitted = !!user?.studentIdImage?.provider;
  const awaitingReview = !rejected && hasSubmitted;
  const needsSubmission = !rejected && !hasSubmitted;

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return toast('Choose a Student ID photo first', 'error');
    setSubmitting(true);
    setStatus('uploading');
    try {
      const fd = new FormData();
      fd.append('studentIdImage', file);
      setStatus('processing');
      const res = await studentIdApi.submit(fd);
      setStatus('saving');
      updateUser(res.data);
      toast(rejected ? 'Student ID resubmitted — pending review' : 'Student ID submitted — pending review', 'success');
      setFile(null);
    } catch (err) {
      toast(err.response?.data?.message || 'Submission failed', 'error');
    } finally {
      setSubmitting(false);
      setStatus('');
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-20 text-center">
      <div className={`mx-auto mb-4 w-14 h-14 rounded-full flex items-center justify-center ${rejected ? 'bg-red-50' : awaitingReview ? 'bg-blue-50' : 'bg-amber-50'}`}>
        {awaitingReview ? (
          <ShieldCheck className="text-blue-600" size={28} />
        ) : (
          <ShieldAlert className={rejected ? 'text-red-600' : 'text-amber-600'} size={28} />
        )}
      </div>

      <h1 className="text-2xl font-bold text-slate-800 mb-2">
        {rejected ? 'Student ID Not Approved' : awaitingReview ? 'Student ID Submitted' : 'Student ID Verification Required'}
      </h1>

      {rejected && (
        <>
          <p className="text-sm text-slate-500 leading-relaxed">Your submitted Student ID could not be verified.</p>
          {user?.rejectionReason && (
            <div className="mt-3 text-left text-sm bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="font-semibold text-red-700 mb-0.5">Reason</p>
              <p className="text-red-600">{user.rejectionReason}</p>
            </div>
          )}
        </>
      )}

      {awaitingReview && (
        <p className="text-sm text-slate-500 leading-relaxed">
          Your verification request is currently under review.
          <br />
          You will be able to access the dashboard once it's approved.
        </p>
      )}

      {needsSubmission && (
        <p className="text-sm text-slate-500 leading-relaxed">
          Your email is not an official university email.
          <br />
          To verify your student account, please submit your Student ID.
        </p>
      )}

      {(rejected || needsSubmission) && (
        <form onSubmit={submit} className="mt-6 text-left bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
            <UploadCloud size={15} /> {rejected ? 'Resubmit Student ID' : 'Submit Student ID'}
          </p>
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            disabled={submitting}
            className="w-full text-sm rounded-lg border border-slate-300 px-2.5 py-2 mb-3"
          />
          <button
            type="submit"
            disabled={submitting || !file}
            className="w-full h-10 rounded-lg bg-brand-600 text-white text-sm font-semibold disabled:opacity-60"
          >
            {status === 'uploading' && 'Uploading...'}
            {status === 'processing' && 'Processing image...'}
            {status === 'saving' && 'Saving...'}
            {!status && (rejected ? 'Resubmit Student ID' : 'Submit Student ID')}
          </button>
        </form>
      )}

      <div className="flex items-center justify-center gap-3 mt-8">
        <Link
          to="/profile"
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          <UserIcon size={15} /> Profile
        </Link>
        <button
          onClick={() => {
            logout();
            navigate('/');
          }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-800 text-white text-sm font-medium hover:bg-slate-900"
        >
          <LogOut size={15} /> Logout
        </button>
      </div>
    </div>
  );
}
