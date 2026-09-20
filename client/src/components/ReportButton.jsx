import { useState } from 'react';
import { Flag, X } from 'lucide-react';
import { reportApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';

// Report / Flag a piece of content the signed-in user can reach. The reason
// list mirrors the server's models/Report.js; the platform is fixed to 'web'.
// The server re-checks access to the target and rejects a duplicate report, so
// this only has to collect and send the form.
const REASONS = ['Inappropriate', 'Incorrect', 'Broken', 'Spam', 'Copyright', 'Other'];

export default function ReportButton({ entityType, entityId, className = '' }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  // Reporting requires an account — the reporter is recorded server-side, never
  // trusted from the client. Signed-out visitors simply don't see the action.
  if (!user) return null;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await reportApi.submit({ entityType, entityId, reason, description, platform: 'web' });
      toast('Report submitted — thank you', 'success');
      setOpen(false);
      setDescription('');
      setReason(REASONS[0]);
    } catch (err) {
      toast(err.response?.data?.message || 'Could not submit the report', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ||
          'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50'
        }
        title="Report this content"
      >
        <Flag size={16} /> Report
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
          <form onSubmit={submit} className="w-full max-w-md bg-white rounded-xl shadow-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">Report content</h2>
              <button type="button" onClick={() => setOpen(false)} className="p-1 text-slate-400 hover:text-slate-600" aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-slate-500">
              Tell us what's wrong with this content. Reports go to the moderators.
            </p>

            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1">Reason</span>
              <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm">
                {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>

            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1">Description (optional)</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={1000}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Add any detail that helps us review this."
              />
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button disabled={busy} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-60">
                {busy ? 'Sending...' : 'Submit report'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
