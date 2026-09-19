import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { profileApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';

// Account deletion, from the account holder's side.
//
// Google Play requires an app that lets people create accounts to offer
// deletion from inside the app as well as at a public URL, so this is the
// in-app half (the public half is pages/legal/DeleteAccount.jsx).

const STATUS = {
  pending: {
    icon: Clock,
    title: 'Deletion requested',
    tone: 'border-amber-200 bg-amber-50 text-amber-800',
    body: 'An administrator will review your request. Nothing has been removed yet. You can keep using the portal normally until it is reviewed.',
  },
  approved: {
    icon: CheckCircle2,
    title: 'Account deleted',
    tone: 'border-slate-200 bg-slate-50 text-slate-700',
    body: 'Your identifying details and Student ID photo have been removed and this account can no longer sign in.',
  },
  rejected: {
    icon: AlertTriangle,
    title: 'Request not approved',
    tone: 'border-slate-200 bg-slate-50 text-slate-700',
    body: 'Your account has not been changed. You can submit a new request below, or contact the university if you think this was a mistake.',
  },
};

export default function DeleteAccountCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({ queryKey: ['deletion-request'], queryFn: profileApi.deletionRequest });
  const request = data?.data;

  const submit = async () => {
    setBusy(true);
    try {
      await profileApi.requestDeletion({ reason });
      toast('Deletion request submitted. An administrator will review it.', 'success');
      setConfirming(false);
      setReason('');
      qc.invalidateQueries({ queryKey: ['deletion-request'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Could not submit the request', 'error');
    } finally {
      setBusy(false);
    }
  };

  // A pending or approved request is a state, not a form — the only way out of
  // "approved" is the account being gone, and a second pending request would
  // just be a duplicate for the reviewer.
  if (request && request.status !== 'rejected') {
    const view = STATUS[request.status];
    const Icon = view.icon;
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="font-semibold text-slate-700 flex items-center gap-2">
          <Trash2 size={16} /> Delete my account
        </h2>
        <div className={`mt-3 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${view.tone}`}>
          <Icon size={17} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-medium">{view.title}</p>
            <p className="mt-0.5">{view.body}</p>
            {request.reviewNote && (
              <p className="mt-2 text-xs opacity-80">Reviewer note: {request.reviewNote}</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="font-semibold text-slate-700 flex items-center gap-2">
        <Trash2 size={16} /> Delete my account
      </h2>
      <p className="text-sm text-slate-500 mt-1">
        Ask the university to delete your account. Your name, email, phone, Student ID and Student ID photo are removed,
        and you are signed out everywhere. Academic records — results, submissions and enrollments — are kept but no
        longer linked to you. {' '}
        <Link to="/delete-account" className="text-brand-700 font-medium hover:underline">
          What is removed and kept
        </Link>
      </p>

      {!confirming ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-4 h-10 px-4 rounded-lg border border-danger text-danger text-sm font-semibold hover:bg-red-50"
        >
          Request account deletion
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <p>This asks the university to delete your account. It cannot be undone once approved.</p>
          </div>
          <textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional)"
            className="input py-2"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="h-10 px-4 rounded-lg bg-danger text-white text-sm font-semibold disabled:opacity-60"
            >
              {busy ? 'Submitting...' : 'Yes, request deletion'}
            </button>
            <button
              type="button"
              onClick={() => { setConfirming(false); setReason(''); }}
              className="h-10 px-4 rounded-lg border border-slate-300 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
