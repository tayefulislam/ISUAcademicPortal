import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ClipboardCheck, FileStack } from 'lucide-react';
import { reviewApi, facultyApi } from '../../api/endpoints.js';
import StatCard from '../../components/StatCard.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function FacultyDashboard() {
  const { user } = useAuth();
  const { data: pending } = useQuery({ queryKey: ['pending-reviews'], queryFn: reviewApi.pending });
  const { data: files } = useQuery({ queryKey: ['faculty-files', '', 1], queryFn: () => facultyApi.files({ limit: 1 }) });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Welcome, {user?.name}</h1>
        <p className="text-sm text-slate-500 mt-0.5">Review student submissions and manage materials in your assigned scope.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard label="Pending Submissions" value={pending?.data?.length ?? 0} icon={ClipboardCheck} />
        <StatCard label="Assigned Materials" value={files?.pagination?.total ?? 0} icon={FileStack} />
      </div>

      <div className="flex gap-3">
        <Link to="/faculty/reviews" className="px-4 py-2.5 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700">
          Review Submissions
        </Link>
        <Link to="/faculty/files" className="px-4 py-2.5 rounded-lg border border-slate-300 font-semibold text-slate-700 hover:bg-slate-50">
          Assigned Materials
        </Link>
      </div>
    </div>
  );
}
