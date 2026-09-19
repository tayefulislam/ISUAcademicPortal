import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2, Check, X, AlertTriangle } from 'lucide-react';
import { superAdminApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

// The review queue for account-deletion requests.
//
// A request never deletes anything by itself — this is where the decision is
// made. Approving erases the person's identifying data, closes the account and
// signs them out everywhere; the academic records the university must keep
// (results, submissions, enrollments) stay, no longer linked to an identifiable
// person.

const FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: '', label: 'All' },
];

const STATUS_TONE = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-slate-100 text-slate-600 border-slate-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
};

function when(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function SuperAdminDeletions() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');
  const [busy, setBusy] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['deletion-requests', status],
    queryFn: () => superAdminApi.deletionRequests(status ? { status } : undefined),
  });

  const items = data?.data || [];

  const review = async (item, approve) => {
    const who = item.user?.name || 'this account';
    const question = approve
      ? `Delete ${who}'s account?\n\nTheir name, email, phone, Student ID and ID photo are erased and they are signed out everywhere. Academic records (results, submissions, enrollments) are kept, no longer linked to them.\n\nThis cannot be undone.`
      : `Reject ${who}'s deletion request? Their account is left exactly as it is.`;
    if (!window.confirm(question)) return;

    setBusy(item.id);
    try {
      if (approve) {
        await superAdminApi.approveDeletion(item.id);
        toast('Account deleted', 'success');
      } else {
        await superAdminApi.rejectDeletion(item.id);
        toast('Request rejected', 'success');
      }
      qc.invalidateQueries({ queryKey: ['deletion-requests'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Could not update the request', 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Account Deletion Requests</h1>
      <p className="text-sm text-slate-500 mb-5">
        Requests submitted from the app or the public deletion page. Approving one erases the person&apos;s identifying
        data and closes the account.
      </p>

      <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-lg w-fit mb-6">
        {FILTERS.map((f) => (
          <button
            key={f.key || 'all'}
            onClick={() => setStatus(f.key)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${
              status === f.key ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-slate-400">Loading...</p>
      ) : items.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <Trash2 size={22} className="mx-auto text-slate-300 mb-2" />
          <p className="text-sm text-slate-500">Nothing here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800">{item.user?.name || 'Account no longer exists'}</p>
                  <p className="text-sm text-slate-500">
                    {item.user?.email || '—'}
                    {item.user?.rollNo ? ` · ${item.user.rollNo}` : ''}
                    {item.user?.role ? ` · ${item.user.role}` : ''}
                  </p>
                  <p className="text-xs text-slate-400 mt-1">Requested {when(item.requestedAt)}</p>
                  {item.reason && (
                    <p className="text-sm text-slate-600 mt-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                      “{item.reason}”
                    </p>
                  )}
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full border ${STATUS_TONE[item.status]}`}>
                  {item.status}
                </span>
              </div>

              {item.status === 'pending' && (
                <div className="flex flex-wrap gap-2 mt-4">
                  <button
                    onClick={() => review(item, true)}
                    disabled={busy === item.id}
                    className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-danger text-white text-sm font-semibold disabled:opacity-60"
                  >
                    <Check size={15} /> Approve &amp; delete account
                  </button>
                  <button
                    onClick={() => review(item, false)}
                    disabled={busy === item.id}
                    className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg border border-slate-300 text-sm font-medium disabled:opacity-60"
                  >
                    <X size={15} /> Reject
                  </button>
                </div>
              )}

              {item.status !== 'pending' && item.reviewedAt && (
                <p className="text-xs text-slate-400 mt-3">
                  Reviewed {when(item.reviewedAt)}
                  {item.reviewNote ? ` — ${item.reviewNote}` : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <AlertTriangle size={16} className="mt-0.5 shrink-0" />
        <p>
          Approval is permanent and irreversible. The account can no longer sign in, and every device it was signed in
          on is logged out immediately.
        </p>
      </div>
    </div>
  );
}
