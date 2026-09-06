import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, X, Eye } from 'lucide-react';
import { reviewApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatBytes, formatDate } from '../../utils/format.js';

// Shared by Admin, Super Admin, and Faculty — the server scopes what each
// role actually sees/can act on (reviewController.js), this component just
// renders whatever GET /reviews/pending returns.
export default function ReviewQueue() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['pending-reviews'], queryFn: reviewApi.pending });

  const submissions = data?.data || [];

  const approve = async (id) => {
    try {
      await reviewApi.approve(id);
      toast('Submission approved and published', 'success');
      qc.invalidateQueries({ queryKey: ['pending-reviews'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Approve failed', 'error');
    }
  };

  const reject = async (id) => {
    if (!confirm('Reject and permanently delete this submission? This cannot be undone.')) return;
    try {
      await reviewApi.reject(id);
      toast('Submission rejected and deleted', 'success');
      qc.invalidateQueries({ queryKey: ['pending-reviews'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Reject failed', 'error');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Material Submissions</h1>
      <p className="text-sm text-slate-500 mb-4">Student-submitted materials awaiting review.</p>

      {isLoading ? (
        <p className="text-slate-400">Loading...</p>
      ) : submissions.length === 0 ? (
        <p className="text-slate-400">No pending submissions.</p>
      ) : (
        <div className="space-y-3">
          {submissions.map((f) => (
            <div key={f._id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-700">{f.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {f.department?.name} &middot; {f.course?.name} ({f.course?.courseId}) &middot; {f.fileType?.toUpperCase()} &middot;{' '}
                  {formatBytes(f.fileSize)}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Submitted by {f.uploadedBy?.name} ({f.uploadedBy?.email}) &middot; {formatDate(f.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Link to={`/files/${f._id}`} target="_blank" className="p-2 rounded-md hover:bg-slate-100" title="Preview">
                  <Eye size={16} />
                </Link>
                <button
                  onClick={() => approve(f._id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700"
                >
                  <Check size={14} /> Approve
                </button>
                <button
                  onClick={() => reject(f._id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-50 text-red-600 border border-red-200 text-sm font-medium hover:bg-red-100"
                >
                  <X size={14} /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
