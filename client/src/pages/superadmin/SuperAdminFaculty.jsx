import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, ShieldCheck, ShieldOff } from 'lucide-react';
import { superAdminApi, departmentApi, courseApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/format.js';

const empty = { name: '', email: '', password: '', assignedDepartments: [], assignedCourses: [] };

export default function SuperAdminFaculty() {
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data: courses } = useQuery({ queryKey: ['all-courses'], queryFn: () => courseApi.list({ limit: 500 }) });
  const { data, isLoading } = useQuery({ queryKey: ['faculty-list'], queryFn: superAdminApi.listFaculty });

  const toggleIn = (key) => (id) => {
    setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await superAdminApi.updateFaculty(editingId, {
          name: form.name,
          email: form.email,
          assignedDepartments: form.assignedDepartments,
          assignedCourses: form.assignedCourses,
        });
        toast('Faculty updated', 'success');
      } else {
        await superAdminApi.createFaculty(form);
        toast('Faculty account created', 'success');
      }
      setForm(empty);
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['faculty-list'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Save failed', 'error');
    }
  };

  const edit = (f) => {
    setEditingId(f._id);
    setForm({
      name: f.name,
      email: f.email,
      password: '',
      assignedDepartments: (f.assignedDepartments || []).map((d) => d._id || d),
      assignedCourses: (f.assignedCourses || []).map((c) => c._id || c),
    });
  };

  const toggleStatus = async (f) => {
    const next = f.status === 'blocked' ? 'active' : 'blocked';
    if (!confirm(`${next === 'blocked' ? 'Deactivate' : 'Reactivate'} ${f.name}?`)) return;
    try {
      await superAdminApi.updateUserStatus(f._id, next);
      toast(`Faculty ${next === 'blocked' ? 'deactivated' : 'reactivated'}`, 'success');
      qc.invalidateQueries({ queryKey: ['faculty-list'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to update status', 'error');
    }
  };

  const faculty = data?.data || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Faculty</h1>
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Full name" className="input" />
          <input
            required
            type="email"
            disabled={!!editingId}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="Email"
            className="input"
          />
          {!editingId && (
            <input
              required
              type="password"
              minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Password"
              className="input"
            />
          )}

          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5">Assigned Departments</p>
            <div className="flex flex-wrap gap-2">
              {(departments?.data || []).map((d) => (
                <button
                  type="button"
                  key={d._id}
                  onClick={() => toggleIn('assignedDepartments')(d._id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                    form.assignedDepartments.includes(d._id) ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-300 text-slate-600'
                  }`}
                >
                  {d.code}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1.5">Assigned Courses</p>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {(courses?.data || []).map((c) => (
                <button
                  type="button"
                  key={c._id}
                  onClick={() => toggleIn('assignedCourses')(c._id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                    form.assignedCourses.includes(c._id) ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-300 text-slate-600'
                  }`}
                >
                  {c.courseId}
                </button>
              ))}
            </div>
          </div>

          <button className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center justify-center gap-2">
            <Plus size={16} /> {editingId ? 'Update' : 'Create'} Faculty
          </button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm(empty); }} className="w-full h-9 text-sm text-slate-500">
              Cancel edit
            </button>
          )}
        </form>
      </div>

      <div className="lg:col-span-2 space-y-2">
        {isLoading ? (
          <p className="text-slate-400">Loading...</p>
        ) : faculty.length === 0 ? (
          <p className="text-slate-400">No faculty accounts yet.</p>
        ) : (
          faculty.map((f) => (
            <div key={f._id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-700">
                  {f.name}{' '}
                  <span className={`ml-1 px-2 py-0.5 rounded-full text-xs font-medium ${f.status === 'blocked' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-700'}`}>
                    {f.status === 'blocked' ? 'deactivated' : 'active'}
                  </span>
                </p>
                <p className="text-xs text-slate-500 mt-0.5">{f.email}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {(f.assignedDepartments || []).map((d) => d.code).join(', ') || 'No departments'} &middot;{' '}
                  {(f.assignedCourses || []).map((c) => c.courseId).join(', ') || 'No courses'}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">Joined {formatDate(f.createdAt)}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => edit(f)} className="p-2 rounded-md hover:bg-slate-100" title="Edit">
                  <Pencil size={16} />
                </button>
                <button
                  onClick={() => toggleStatus(f)}
                  title={f.status === 'blocked' ? 'Reactivate' : 'Deactivate'}
                  className={`p-2 rounded-md hover:bg-slate-100 ${f.status === 'blocked' ? 'text-emerald-600' : 'text-red-600'}`}
                >
                  {f.status === 'blocked' ? <ShieldCheck size={16} /> : <ShieldOff size={16} />}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <style>{`.input { width: 100%; height: 2.5rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; }
      .input:disabled { background-color: #f1f5f9; color: #94a3b8; }`}</style>
    </div>
  );
}
