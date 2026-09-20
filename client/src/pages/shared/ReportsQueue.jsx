import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Flag, ExternalLink, Trash2 } from 'lucide-react';
import { reportApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/format.js';

// Content-moderation queue for the Report/Flag system. Shared by the Admin and
// Super Admin panels (the server gates it by the `reports` permission — this is
// only the matching UI). A moderator sees the reported item's snapshot (kept
// even if the record is later edited/removed), the reporter, the platform the
// report came from, and can move it through pending → reviewing → resolved /
// rejected.
const STATUSES = ['pending', 'reviewing', 'resolved', 'rejected'];
const STATUS_STYLE = {
  pending: 'bg-amber-50 text-amber-700',
  reviewing: 'bg-brand-50 text-brand-700',
  resolved: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-slate-100 text-slate-600',
};

export default function ReportsQueue() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState('pending');

  const { data, isLoading } = useQuery({
    queryKey: ['reports', status],
    queryFn: () => reportApi.list({ status: status || undefined, limit: 100 }),
  });
  const reports = data?.data || [];

  const setReportStatus = async (id, next) => {
    try {
      await reportApi.updateStatus(id, next);
      toast('Report updated', 'success');
      qc.invalidateQueries({ queryKey: ['reports'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Update failed', 'error');
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this report? This cannot be undone.')) return;
    try {
      await reportApi.remove(id);
      toast('Report deleted', 'success');
      qc.invalidateQueries({ queryKey: ['reports'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed', 'error');
    }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Flag className="text-brand-600" size={22} />
        <h1 className="text-2xl font-bold text-slate-800">Reports</h1>
      </div>
      <p className="text-sm text-slate-500 mb-4">User-submitted reports/flags on portal content.</p>

      <div className="flex flex-wrap gap-1.5 mb-5">
        {['', ...STATUSES].map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setStatus(s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
              status === s ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:border-brand-300'
            }`}
          >
            {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <p className="text-slate-400">Loading...</p>
      ) : reports.length === 0 ? (
        <p className="text-slate-400">No reports here.</p>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <div key={r._id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-700">
                    {r.snapshot?.title || `${r.entityType} report`}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {r.entityType} &middot; {r.reason} &middot; {r.platform}
                    {r.snapshot?.subtitle ? ` · ${r.snapshot.subtitle}` : ''}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Reported by {r.reporter?.name || '—'} &middot; {formatDate(r.createdAt)}
                  </p>
                  {r.description && <p className="text-sm text-slate-600 mt-2">{r.description}</p>}
                  {r.snapshot?.url && (
                    <a href={r.snapshot.url} className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline mt-1">
                      <ExternalLink size={12} /> Open reported item
                    </a>
                  )}
                </div>
                <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLE[r.status] || 'bg-slate-100 text-slate-600'}`}>
                  {r.status}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100">
                {STATUSES.filter((s) => s !== r.status).map((s) => (
                  <button
                    key={s}
                    onClick={() => setReportStatus(r._id, s)}
                    className="px-3 py-1.5 rounded-md border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Mark {s}
                  </button>
                ))}
                <button
                  onClick={() => remove(r._id)}
                  className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 rounded-md border border-red-200 text-xs font-medium text-red-600 hover:bg-red-50"
                >
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
