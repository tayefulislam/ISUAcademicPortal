import { useQuery } from '@tanstack/react-query';
import { Files, Building2, BookOpen, Users2, UsersRound, Download, Eye } from 'lucide-react';
import { analyticsApi } from '../../api/endpoints.js';
import StatCard from '../../components/StatCard.jsx';
import { formatDate } from '../../utils/format.js';

export default function AdminDashboard() {
  const { data, isLoading } = useQuery({ queryKey: ['admin-dashboard'], queryFn: analyticsApi.dashboard });
  const d = data?.data;

  if (isLoading) return <p className="text-slate-400">Loading dashboard...</p>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Files" value={d.totals.files} icon={Files} />
        <StatCard label="Departments" value={d.totals.departments} icon={Building2} />
        <StatCard label="Courses" value={d.totals.courses} icon={BookOpen} />
        <StatCard label="Batches" value={d.totals.batches} icon={Users2} />
        <StatCard label="Total Users" value={d.totals.users} icon={UsersRound} />
        <StatCard label="Total Views" value={d.totals.views} icon={Eye} />
        <StatCard label="Total Downloads" value={d.totals.downloads} icon={Download} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Recent Uploads">
          {d.recentUploads.map((f) => (
            <Row key={f._id} left={f.title} right={formatDate(f.createdAt)} sub={f.courseName} />
          ))}
        </Panel>
        <Panel title="Most Viewed Files">
          {d.mostViewed.map((f) => (
            <Row key={f._id} left={f.title} right={`${f.views} views`} sub={f.courseName} />
          ))}
        </Panel>
        <Panel title="Most Downloaded Files">
          {d.mostDownloaded.map((f) => (
            <Row key={f._id} left={f.title} right={`${f.downloads} downloads`} sub={f.courseName} />
          ))}
        </Panel>
        <Panel title="Popular Courses">
          {d.popularCourses.map((c) => (
            <Row key={c._id} left={c._id} right={`${c.views} views`} sub={`${c.files} files`} />
          ))}
        </Panel>
      </div>
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="font-semibold text-slate-700 mb-3">{title}</h2>
      <div className="space-y-2">{children?.length ? children : <p className="text-sm text-slate-400">No data yet.</p>}</div>
    </div>
  );
}

function Row({ left, right, sub }) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100 last:border-0">
      <div className="min-w-0">
        <p className="truncate font-medium text-slate-700">{left}</p>
        {sub && <p className="text-xs text-slate-400">{sub}</p>}
      </div>
      <span className="text-slate-400 text-xs shrink-0 ml-2">{right}</span>
    </div>
  );
}
