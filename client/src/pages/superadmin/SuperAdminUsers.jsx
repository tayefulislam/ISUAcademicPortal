import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, ShieldCheck, ShieldOff, Clock, Pencil, X, Download } from 'lucide-react';
import { superAdminApi, departmentApi, batchApi, semesterApi, roleApi, courseApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { useAuth } from '../../context/AuthContext.jsx';
import Pagination from '../../components/Pagination.jsx';
import { formatDate } from '../../utils/format.js';

const ROLE_STYLE = {
  student: 'bg-slate-100 text-slate-600',
  faculty: 'bg-amber-50 text-amber-700',
  admin: 'bg-brand-50 text-brand-700',
  administrator: 'bg-indigo-50 text-indigo-700',
  super_admin: 'bg-purple-50 text-purple-700',
};

export default function SuperAdminUsers() {
  const { user: me, isSuperAdmin } = useAuth();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [role, setRole] = useState('');
  const [department, setDepartment] = useState('');
  const [batch, setBatch] = useState('');
  const [semester, setSemester] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });
  const { data: allCourses } = useQuery({ queryKey: ['all-courses'], queryFn: () => courseApi.list({ limit: 500 }) });
  const { data: rolesData } = useQuery({ queryKey: ['roles'], queryFn: roleApi.list });
  const adminTierRoles = rolesData?.data || []; // Admin, CR, any further role Super Admin created

  const params = { q: debouncedQ || undefined, role: role || undefined, department: department || undefined, batch: batch || undefined, semester: semester || undefined, page, limit: 15 };
  const { data, isLoading } = useQuery({
    queryKey: ['super-admin-users', params],
    queryFn: () => superAdminApi.listUsers(params),
  });

  const changeRole = async (id, nextRole) => {
    if (!confirm(`Change this user's role to "${nextRole}"?`)) return;
    try {
      await superAdminApi.updateUserRole(id, nextRole);
      toast('User role updated', 'success');
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

  // Granting/revoking the 'administrator' role (super_admin-equivalent) is
  // itself restricted to an actual Super Admin — an Administrator can change
  // a student/Admin/CR's role, but not touch another Administrator's role.
  const canChangeRoleOf = (u) => (u.role === 'administrator' ? isSuperAdmin : u.role === 'student' || adminTierRoles.some((r) => r.key === u.role));

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-slate-800">All Users</h1>
        <button
          onClick={() => superAdminApi.exportUsers(params)}
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
            <option value="administrator">Administrator</option>
            {isSuperAdmin && <option value="super_admin">Super Admin</option>}
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
              <th className="p-3 text-left">Last Login</th>
              <th className="p-3 text-left">Last Login IP</th>
              <th className="p-3 text-left">Joined</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={11} className="p-6 text-center text-slate-400">Loading...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={11} className="p-6 text-center text-slate-400">No users found.</td></tr>
            ) : (
              users.map((u) => (
                <tr key={u._id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3 font-medium text-slate-700">{u.name}</td>
                  <td className="p-3 text-slate-500">{u.email}</td>
                  <td className="p-3">{u.rollNo || '-'}</td>
                  <td className="p-3">{u.department?.code || '-'}</td>
                  <td className="p-3">{u.batch?.name || '-'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_STYLE[u.role] || 'bg-teal-50 text-teal-700'}`}>{u.role}</span>
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.status === 'blocked' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                      {u.status}
                    </span>
                  </td>
                  <td className="p-3 text-slate-400">{u.lastLogin ? formatDate(u.lastLogin) : 'Never'}</td>
                  <td className="p-3 text-slate-400 font-mono text-xs">{u.lastLoginIp || '-'}</td>
                  <td className="p-3 text-slate-400">{formatDate(u.createdAt)}</td>
                  <td className="p-3">
                    {u.role !== 'super_admin' && u._id !== me._id && (
                      <div className="flex items-center gap-2">
                        {canChangeRoleOf(u) && (
                          <select
                            value={u.role}
                            onChange={(e) => changeRole(u._id, e.target.value)}
                            title="Change role"
                            className="h-8 rounded-md border border-slate-300 px-1.5 text-xs"
                          >
                            <option value="student">Student</option>
                            {adminTierRoles.map((r) => (
                              <option key={r.key} value={r.key}>{r.name}</option>
                            ))}
                            {isSuperAdmin && <option value="administrator">Administrator</option>}
                          </select>
                        )}
                        <button
                          onClick={() => toggleStatus(u)}
                          title={u.status === 'blocked' ? 'Unblock' : 'Block'}
                          className={`p-1.5 rounded hover:bg-slate-100 ${u.status === 'blocked' ? 'text-emerald-600' : 'text-red-600'}`}
                        >
                          {u.status === 'blocked' ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
                        </button>
                        <button onClick={() => setEditing(u)} title="Edit profile" className="p-1.5 rounded hover:bg-slate-100 text-slate-500">
                          <Pencil size={16} />
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
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_STYLE[u.role] || 'bg-teal-50 text-teal-700'}`}>{u.role}</span>
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
                  <span className="flex items-center gap-1 text-xs text-slate-400" title={u.lastLoginIp ? `IP: ${u.lastLoginIp}` : undefined}>
                    <Clock size={12} /> Last login {formatDate(u.lastLogin)}{u.lastLoginIp ? ` (${u.lastLoginIp})` : ''}
                  </span>
                )}
              </div>

              {u.role !== 'super_admin' && u._id !== me._id && (
                <div className="flex gap-2 mt-3">
                  {canChangeRoleOf(u) && (
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u._id, e.target.value)}
                      className="flex-1 h-8 rounded-md border border-slate-300 px-1.5 text-xs"
                    >
                      <option value="student">Student</option>
                      {adminTierRoles.map((r) => (
                        <option key={r.key} value={r.key}>{r.name}</option>
                      ))}
                      {isSuperAdmin && <option value="administrator">Administrator</option>}
                    </select>
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
                  <button onClick={() => setEditing(u)} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-slate-300 text-sm text-slate-600">
                    <Pencil size={14} /> Edit
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {data?.pagination && <Pagination page={page} pages={data.pagination.pages} onChange={setPage} />}

      {editing && (
        <EditUserProfileModal
          user={editing}
          departments={departments?.data}
          batches={batches?.data}
          semesters={semesters?.data}
          allCourses={allCourses?.data}
          // 'admin' itself is unrestricted, so scoping fields are only
          // meaningful for other admin-tier roles (e.g. "CR").
          showScope={adminTierRoles.some((r) => r.key === editing.role) && editing.role !== 'admin'}
          onClose={() => setEditing(null)}
          onSaved={() => qc.invalidateQueries({ queryKey: ['super-admin-users'] })}
        />
      )}
    </div>
  );
}

// Super Admin can directly edit a user's academic/profile fields — password
// is deliberately never editable here, only via the secure change-password
// flow (server also enforces this: PATCH .../profile ignores a password field).
function EditUserProfileModal({ user, departments, batches, semesters, allCourses, showScope, onClose, onSaved }) {
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: user.name,
    rollNo: user.rollNo || '',
    department: user.department?._id || '',
    batch: user.batch?._id || '',
    semester: user.semester?._id || '',
    assignedDepartments: (user.assignedDepartments || []).map(String),
    assignedCourses: (user.assignedCourses || []).map(String),
  });
  const [saving, setSaving] = useState(false);

  const toggleScope = (key) => (id) => {
    setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await superAdminApi.updateUserProfile(user._id, form);
      toast('Profile updated', 'success');
      onSaved();
      onClose();
    } catch (err) {
      toast(err.response?.data?.message || 'Update failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800">Edit Profile — {user.name}</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" className="input" required />
          <input value={form.rollNo} onChange={(e) => setForm({ ...form, rollNo: e.target.value })} placeholder="Roll No" className="input" />
          <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="input">
            <option value="">No department</option>
            {(departments || []).map((d) => <option key={d._id} value={d._id}>{d.name} ({d.code})</option>)}
          </select>
          <select value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} className="input">
            <option value="">No batch</option>
            {(batches || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>
          <select value={form.semester} onChange={(e) => setForm({ ...form, semester: e.target.value })} className="input">
            <option value="">No semester</option>
            {(semesters || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
          </select>

          {showScope && (
            <div className="space-y-3 border border-slate-200 rounded-lg p-3">
              <p className="text-xs text-slate-500">
                Scopes this role's Review/Approval access to the matching Department(s)/Course(s) — same as Faculty.
              </p>
              <ScopeGroup label="Department" items={departments} value={form.assignedDepartments} onToggle={toggleScope('assignedDepartments')} />
              <ScopeGroup label="Course" items={allCourses} value={form.assignedCourses} onToggle={toggleScope('assignedCourses')} labelKey="courseId" />
            </div>
          )}

          <p className="text-xs text-slate-400">Password cannot be changed here — the user must use the change-password / reset flow.</p>
          <button disabled={saving} className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold disabled:opacity-60">
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </form>
      </div>
      <style>{`.input { width: 100%; height: 2.5rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; }`}</style>
    </div>
  );
}

function ScopeGroup({ label, items, value, onToggle, labelKey = 'name' }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
        {(items || []).map((item) => (
          <button
            type="button"
            key={item._id}
            onClick={() => onToggle(item._id)}
            className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
              value.includes(item._id) ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-300 text-slate-600'
            }`}
          >
            {item[labelKey] || item.name}
          </button>
        ))}
        {!items?.length && <span className="text-xs text-slate-400">None available</span>}
      </div>
    </div>
  );
}
