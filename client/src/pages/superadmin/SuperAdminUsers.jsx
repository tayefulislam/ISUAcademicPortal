import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ShieldCheck, ShieldOff, UserCog, Clock } from 'lucide-react';
import { superAdminApi, departmentApi, batchApi, semesterApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { useAuth } from '../../context/AuthContext.jsx';
import Pagination from '../../components/Pagination.jsx';
import { formatDate } from '../../utils/format.js';

const ROLE_STYLE = {
  student: 'bg-slate-100 text-slate-600',
  faculty: 'bg-amber-50 text-amber-700',
  admin: 'bg-brand-50 text-brand-700',
  super_admin: 'bg-purple-50 text-purple-700',
};

export default function SuperAdminUsers() {
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [role, setRole] = useState('');
  const [department, setDepartment] = useState('');
  const [batch, setBatch] = useState('');
  const [semester, setSemester] = useState('');
  const [page, setPage] = useState(1);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });

  const params = { q: debouncedQ || undefined, role: role || undefined, department: department || undefined, batch: batch || undefined, semester: semester || undefined, page, limit: 15 };
  const { data, isLoading } = useQuery({
    queryKey: ['super-admin-users', params],
    queryFn: () => superAdminApi.listUsers(params),
  });

  const promote = async (id) => {
    if (!confirm('Promote this user to Admin?')) return;
    try {
      await superAdminApi.updateUserRole(id, 'admin');
      toast('User promoted to Admin', 'success');
      qc.invalidateQueries({ queryKey: ['super-admin-users'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to update role', 'error');
    }
  };

  const demote = async (id) => {
    if (!confirm('Change this Admin back to Student?')) return;
    try {
      await superAdminApi.updateUserRole(id, 'student');
      toast('User changed to Student', 'success');
      qc.invalidateQueries({ queryKey: ['super-admin-users'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to update role', 'error');
    }
  };

  const toggleStatus = async (u) => {
    const next = u.status === 'blocked' ? 'active' : 'blocked';
    if (!confirm(`${next === 'blocked' ? 'Block' : 'Unblock'} ${u.name}?`)) return;
    try {
      await superAdminApi.updateUserStatus(u._id, next);
      toast(`User ${next === 'blocked' ? 'blocked' : 'unblocked'}`, 'success');
      qc.invalidateQueries({ queryKey: ['super-admin-users'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to update status', 'error');
    }
  };

  const users = data?.data || [];

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-4">All Users</h1>

      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search by name, email, or roll no..."
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <select value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
            <option value="">All Roles</option>
            <option value="student">Student</option>
            <option value="faculty">Faculty</option>
            <option value="admin">Admin</option>
            <option value="super_admin">Super Admin</option>
          </select>
          <select value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1); }} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
            <option value="">All Departments</option>
            {(departments?.data || []).map((d) => <option key={d._id} value={d._id}>{d.code}</option>)}
          </select>
          <select value={batch} onChange={(e) => { setBatch(e.target.value); setPage(1); }} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
            <option value="">All Batches</option>
            {(batches?.data || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>
          <select value={semester} onChange={(e) => { setSemester(e.target.value); setPage(1); }} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
            <option value="">All Semesters</option>
            {(semesters?.data || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>
        </div>
      </div>

      <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Email</th>
              <th className="p-3 text-left">Roll No</th>
              <th className="p-3 text-left">Department</th>
              <th className="p-3 text-left">Batch</th>
              <th className="p-3 text-left">Role</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-left">Joined</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="p-6 text-center text-slate-400">Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={9} className="p-6 text-center text-slate-400">No users found.</td></tr>
            ) : (
              users.map((u) => (
                <tr key={u._id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3 font-medium text-slate-700">{u.name}</td>
                  <td className="p-3 text-slate-500">{u.email}</td>
                  <td className="p-3">{u.rollNo || '-'}</td>
                  <td className="p-3">{u.department?.code || '-'}</td>
                  <td className="p-3">{u.batch?.name || '-'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_STYLE[u.role]}`}>{u.role}</span>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.status === 'blocked' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="p-3 text-slate-400">{formatDate(u.createdAt)}</td>
                  <td className="p-3">
                    {u.role !== 'super_admin' && u._id !== me._id && (
                      <div className="flex items-center gap-2">
                        {u.role === 'student' ? (
                          <button onClick={() => promote(u._id)} title="Promote to Admin" className="p-1.5 rounded hover:bg-slate-100 text-brand-600">
                            <UserCog size={16} />
                          </button>
                        ) : (
                          <button onClick={() => demote(u._id)} title="Change to Student" className="p-1.5 rounded hover:bg-slate-100 text-slate-500">
                            <UserCog size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => toggleStatus(u)}
                          title={u.status === 'blocked' ? 'Unblock' : 'Block'}
                          className={`p-1.5 rounded hover:bg-slate-100 ${u.status === 'blocked' ? 'text-emerald-600' : 'text-red-600'}`}
                        >
                          {u.status === 'blocked' ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards — the desktop table is simply hidden below md, so
          without this the user list disappeared entirely on small screens. */}
      <div className="md:hidden space-y-3">
        {isLoading ? (
          <p className="text-center text-slate-400 py-6">Loading...</p>
        ) : users.length === 0 ? (
          <p className="text-center text-slate-400 py-6">No users found.</p>
        ) : (
          users.map((u) => (
            <div key={u._id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-700 truncate">{u.name}</p>
                  <p className="text-sm text-slate-500 truncate">{u.email}</p>
                </div>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_STYLE[u.role]}`}>{u.role}</span>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-500">
                <p>Roll No: <span className="text-slate-700">{u.rollNo || '-'}</span></p>
                <p>Department: <span className="text-slate-700">{u.department?.code || '-'}</span></p>
                <p>Batch: <span className="text-slate-700">{u.batch?.name || '-'}</span></p>
                <p>Joined: <span className="text-slate-700">{formatDate(u.createdAt)}</span></p>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${u.status === 'blocked' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                  {u.status === 'blocked' ? <ShieldOff size={12} /> : <ShieldCheck size={12} />} {u.status}
                </span>
                {u.lastLogin && (
                  <span className="flex items-center gap-1 text-xs text-slate-400">
                    <Clock size={12} /> Last login {formatDate(u.lastLogin)}
                  </span>
                )}
              </div>

              {u.role !== 'super_admin' && u._id !== me._id && (
                <div className="flex gap-2 mt-3">
                  {u.role === 'student' ? (
                    <button
                      onClick={() => promote(u._id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-slate-300 text-sm text-brand-600"
                    >
                      <UserCog size={14} /> Promote
                    </button>
                  ) : (
                    <button
                      onClick={() => demote(u._id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-slate-300 text-sm text-slate-600"
                    >
                      <UserCog size={14} /> To Student
                    </button>
                  )}
                  <button
                    onClick={() => toggleStatus(u)}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md border text-sm font-medium ${
                      u.status === 'blocked' ? 'border-emerald-200 text-emerald-600' : 'border-red-200 text-red-600'
                    }`}
                  >
                    {u.status === 'blocked' ? <ShieldCheck size={14} /> : <ShieldOff size={14} />}
                    {u.status === 'blocked' ? 'Unblock' : 'Block'}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {data?.pagination && <Pagination page={page} pages={data.pagination.pages} onChange={setPage} />}
    </div>
  );
}
