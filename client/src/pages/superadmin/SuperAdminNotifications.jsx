import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Bell, BarChart3, Search } from 'lucide-react';
import { adminNotificationApi, departmentApi, courseApi, superAdminApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

const SCOPES = [
  { value: 'user', label: 'Specific User' },
  { value: 'course', label: 'Course' },
  { value: 'department', label: 'Department' },
  { value: 'all', label: 'Everyone (all students & faculty)' },
];

// Admin -> Notifications (spec §20): send an ad-hoc notification to a
// specific user/course/department/everyone, and see delivery stats/logs.
// Mirrors EmailComposer.jsx's send-then-refresh-history pattern.
export default function SuperAdminNotifications() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ scope: 'user', targetId: '', title: '', message: '', url: '' });
  const [userSearch, setUserSearch] = useState('');

  const { data: stats } = useQuery({ queryKey: ['admin-notif-stats'], queryFn: () => adminNotificationApi.stats().then((r) => r.data) });
  const { data: logs, isLoading: logsLoading } = useQuery({ queryKey: ['admin-notif-logs'], queryFn: () => adminNotificationApi.logs({ limit: 30 }).then((r) => r.data) });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list, enabled: form.scope === 'department' });
  const { data: courses } = useQuery({ queryKey: ['all-courses-notif'], queryFn: () => courseApi.list({ limit: 500 }), enabled: form.scope === 'course' });
  const { data: userResults } = useQuery({
    queryKey: ['admin-notif-user-search', userSearch],
    queryFn: () => superAdminApi.listUsers({ q: userSearch, limit: 10 }),
    enabled: form.scope === 'user' && userSearch.length > 0,
  });

  const submit = async (e) => {
    e.preventDefault();
    if (form.scope !== 'all' && !form.targetId) return toast('Pick a target for this scope', 'error');
    if (!confirm('Send this notification now?')) return;
    try {
      const res = await adminNotificationApi.send(form);
      toast(res.message || 'Notification sent', 'success');
      setForm({ scope: form.scope, targetId: '', title: '', message: '', url: '' });
      qc.invalidateQueries({ queryKey: ['admin-notif-stats'] });
      qc.invalidateQueries({ queryKey: ['admin-notif-logs'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Send failed', 'error');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <h1 className="text-2xl font-bold text-slate-800 mb-4 flex items-center gap-2">
          <Bell size={22} /> Notifications
        </h1>

        {stats && (
          <div className="grid grid-cols-3 gap-2 mb-4">
            <StatCard label="Total" value={stats.total} />
            <StatCard label="Unread" value={stats.unread} />
            <StatCard label="Read" value={stats.read} />
          </div>
        )}

        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value, targetId: '' })} className="input">
            {SCOPES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          {form.scope === 'user' && (
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} placeholder="Search by name..." className="input pl-8" />
              {userSearch && (
                <div className="max-h-32 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-50 mt-1">
                  {(userResults?.data || []).map((u) => (
                    <button
                      type="button"
                      key={u._id}
                      onClick={() => { setForm({ ...form, targetId: u._id }); setUserSearch(u.name); }}
                      className={`w-full text-left px-2.5 py-1.5 text-sm hover:bg-slate-50 ${form.targetId === u._id ? 'bg-brand-50' : ''}`}
                    >
                      {u.name} <span className="text-xs text-slate-400 capitalize">({u.role})</span>
                    </button>
                  ))}
                  {!userResults?.data?.length && <p className="text-xs text-slate-400 px-2.5 py-1.5">No matches</p>}
                </div>
              )}
            </div>
          )}

          {form.scope === 'course' && (
            <select value={form.targetId} onChange={(e) => setForm({ ...form, targetId: e.target.value })} className="input">
              <option value="">Select course</option>
              {(courses?.data || []).map((c) => <option key={c._id} value={c._id}>{c.courseId} — {c.name}</option>)}
            </select>
          )}

          {form.scope === 'department' && (
            <select value={form.targetId} onChange={(e) => setForm({ ...form, targetId: e.target.value })} className="input">
              <option value="">Select department</option>
              {(departments?.data || []).map((d) => <option key={d._id} value={d._id}>{d.name}</option>)}
            </select>
          )}

          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" className="input" />
          <textarea required rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Message" className="input" />
          <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="Link (optional, e.g. /notices)" className="input" />

          <button className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center justify-center gap-2">
            <Send size={16} /> Send Notification
          </button>
        </form>
      </div>

      <div className="lg:col-span-2 space-y-2">
        <h2 className="text-lg font-semibold text-slate-700 flex items-center gap-2"><BarChart3 size={18} /> Recent Notifications</h2>
        {stats?.byType?.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {stats.byType.map((t) => (
              <span key={t.type} className="px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                {t.type}: {t.count}
              </span>
            ))}
          </div>
        )}
        {logsLoading ? (
          <p className="text-slate-400">Loading...</p>
        ) : !logs?.data?.length ? (
          <p className="text-slate-400">No notifications yet.</p>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
            {logs.data.map((n) => (
              <div key={n._id} className="p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{n.title}</p>
                  <p className="text-xs text-slate-400 truncate">
                    To {n.recipient?.name || 'Unknown'} · {n.type} · {new Date(n.createdAt).toLocaleString()}
                  </p>
                </div>
                <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full ${n.isRead ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                  {n.isRead ? 'Read' : 'Unread'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`.input { width: 100%; height: 2.5rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; }
      textarea.input { height: auto; padding: 0.6rem 0.75rem; }`}</style>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-2.5 text-center">
      <p className="text-lg font-bold text-slate-800">{value}</p>
      <p className="text-[11px] text-slate-500">{label}</p>
    </div>
  );
}
