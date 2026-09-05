import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Files, Eye, Download, Upload } from 'lucide-react';
import { adminApi } from '../../api/endpoints.js';
import StatCard from '../../components/StatCard.jsx';
import { formatDate } from '../../utils/format.js';
import { useAuth } from '../../context/AuthContext.jsx';

// An Admin only ever sees their own upload activity here — Super Admin has
// a separate system-wide dashboard at /super-admin. The backend enforces
// this scoping itself (GET /admin/files always filters by uploadedBy), so
// there's nothing extra to hide on this page.
export default function AdminDashboard() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-my-dashboard'],
    queryFn: () => adminApi.myFiles({ limit: 5 }),
  });

  const files = data?.data || [];
  const total = data?.pagination?.total ?? 0;
  const totalViews = files.reduce((sum, f) => sum + (f.views || 0), 0);
  const totalDownloads = files.reduce((sum, f) => sum + (f.downloads || 0), 0);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Welcome, {user?.name}</h1>
          <p className="text-sm text-slate-500 mt-0.5">Here's a summary of your uploaded files.</p>
        </div>
        <Link
          to="/admin/upload"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700"
        >
          <Upload size={18} /> Upload File
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="My Files" value={total} icon={Files} />
        <StatCard label="Views (recent)" value={totalViews} icon={Eye} />
        <StatCard label="Downloads (recent)" value={totalDownloads} icon={Download} />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-700">Recent Uploads</h2>
          <Link to="/admin/files" className="text-sm text-brand-600 hover:underline">
            View all
          </Link>
        </div>
        {isLoading ? (
          <p className="text-sm text-slate-400">Loading...</p>
        ) : files.length ? (
          <div className="space-y-2">
            {files.map((f) => (
              <div key={f._id} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100 last:border-0">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-700">{f.title}</p>
                  <p className="text-xs text-slate-400">{f.courseName}</p>
                </div>
                <span className="text-slate-400 text-xs shrink-0 ml-2">{formatDate(f.createdAt)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">You haven't uploaded any files yet.</p>
        )}
      </div>
    </div>
  );
}
