import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Download, Trash2, Star } from 'lucide-react';
import { feedbackApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { formatDate } from '../../utils/format.js';
import Pagination from '../../components/Pagination.jsx';

const CATEGORIES = ['Website', 'Academic Material', 'Faculty', 'Technical Issue', 'Suggestion', 'Other'];
const STATUS_STYLE = {
  new: 'bg-amber-50 text-amber-700',
  reviewed: 'bg-brand-50 text-brand-700',
  resolved: 'bg-emerald-50 text-emerald-700',
};

export default function SuperAdminFeedback() {
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { toast } = useToast();
  const qc = useQueryClient();

  const params = { q: debouncedQ || undefined, category: category || undefined, status: status || undefined, page, limit: 15 };
  const { data, isLoading } = useQuery({ queryKey: ['feedback', params], queryFn: () => feedbackApi.list(params) });

  const items = data?.data || [];

  const setItemStatus = async (id, next) => {
    try {
      await feedbackApi.updateStatus(id, next);
      toast('Status updated', 'success');
      qc.invalidateQueries({ queryKey: ['feedback'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Update failed', 'error');
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this feedback permanently?')) return;
    try {
      await feedbackApi.remove(id);
      toast('Feedback deleted', 'success');
      qc.invalidateQueries({ queryKey: ['feedback'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed', 'error');
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-slate-800">Feedback</h1>
        <button
          onClick={() => feedbackApi.export(params)}
          className="flex items-center gap-1.5 h-10 px-4 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50"
        >
          <Download size={16} /> Export CSV
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search name, email, subject, message..."
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <select value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
            <option value="">All Categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
            <option value="">All Statuses</option>
            <option value="new">New</option>
            <option value="reviewed">Reviewed</option>
            <option value="resolved">Resolved</option>
          </select>
        </div>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <p className="text-center text-slate-400 py-6">Loading...</p>
        ) : items.length === 0 ? (
          <p className="text-center text-slate-400 py-6">No feedback found.</p>
        ) : (
          items.map((f) => (
            <div key={f._id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-700">{f.subject}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {f.name} ({f.email}) &middot; {f.category} &middot; {formatDate(f.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {f.rating && (
                    <span className="flex items-center gap-0.5 text-xs text-amber-500">
                      <Star size={12} fill="currentColor" /> {f.rating}
                    </span>
                  )}
                  <select
                    value={f.status}
                    onChange={(e) => setItemStatus(f._id, e.target.value)}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium border-0 ${STATUS_STYLE[f.status]}`}
                  >
                    <option value="new">New</option>
                    <option value="reviewed">Reviewed</option>
                    <option value="resolved">Resolved</option>
                  </select>
                  <button onClick={() => remove(f._id)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Delete">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <p className="text-sm text-slate-600 mt-2">{f.message}</p>
            </div>
          ))
        )}
      </div>

      {data?.pagination && <Pagination page={page} pages={data.pagination.pages} onChange={setPage} />}
    </div>
  );
}
