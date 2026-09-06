import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Sparkles, Clock, Bookmark, FileClock } from 'lucide-react';
import FileCard from '../components/FileCard.jsx';
import FileGridSkeleton from '../components/FileGridSkeleton.jsx';
import { fileApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useDownloadFile } from '../hooks/useDownloadFile.js';
import { formatDate } from '../utils/format.js';

export default function Dashboard() {
  const { user } = useAuth();
  const download = useDownloadFile();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => fileApi.dashboard(8) });
  const { data: mine, isLoading: loadingMine } = useQuery({
    queryKey: ['my-submissions'],
    queryFn: () => fileApi.mine({ limit: 5 }),
    enabled: user?.role === 'student',
  });

  const recommended = data?.data?.recommended || [];
  const recent = data?.data?.recent || [];
  const bookmarked = data?.data?.bookmarked || [];
  const submissions = mine?.data || [];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Welcome back, {user?.name?.split(' ')[0]}</h1>
      <p className="text-sm text-slate-500 mb-8">Materials picked for your department, batch, and semester.</p>

      {user?.role === 'student' && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <FileClock className="text-brand-600" size={20} />
            <h2 className="text-xl font-bold text-slate-800">My Submissions</h2>
          </div>
          {loadingMine ? (
            <p className="text-slate-400">Loading...</p>
          ) : submissions.length === 0 ? (
            <p className="text-slate-400">
              You haven't submitted any materials yet.{' '}
              <Link to="/submit-material" className="text-brand-600 hover:underline">
                Submit one
              </Link>
              .
            </p>
          ) : (
            <div className="space-y-2">
              {submissions.map((f) => (
                <div key={f._id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-700 truncate">{f.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {f.departmentCode} &middot; {f.courseId} &middot; {formatDate(f.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${
                      f.approvalStatus === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {f.approvalStatus === 'pending' ? 'Pending review' : 'Approved'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <Section title="Recommended for you" icon={Sparkles} loading={isLoading} files={recommended} download={download} empty="No recommended materials yet." />
      <Section title="Recently added" icon={Clock} loading={isLoading} files={recent} download={download} empty="Nothing recent yet." />
      <Section title="Your bookmarks" icon={Bookmark} loading={isLoading} files={bookmarked} download={download} empty="You haven't bookmarked anything yet." />
    </div>
  );
}

function Section({ title, icon: Icon, loading, files, download, empty }) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="text-brand-600" size={20} />
        <h2 className="text-xl font-bold text-slate-800">{title}</h2>
      </div>
      {loading ? (
        <FileGridSkeleton count={3} />
      ) : files.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {files.map((f) => (
            <FileCard key={f._id} file={f} onDownload={download} />
          ))}
        </div>
      ) : (
        <p className="text-slate-400">{empty}</p>
      )}
    </section>
  );
}
