import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Search } from 'lucide-react';
import { departmentApi, courseApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';

const empty = { name: '', courseId: '', department: '', credit: 3, semester: '', description: '' };

export default function AdminCourses() {
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data, isLoading } = useQuery({
    queryKey: ['all-courses', debouncedQ],
    queryFn: () => courseApi.list({ q: debouncedQ || undefined, limit: 500 }),
  });

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await courseApi.update(editingId, form);
        toast('Course updated', 'success');
      } else {
        await courseApi.create(form);
        toast('Course created', 'success');
      }
      setForm(empty);
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['all-courses'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Save failed', 'error');
    }
  };

  const edit = (c) => {
    setEditingId(c._id);
    setForm({ name: c.name, courseId: c.courseId, department: c.department?._id || c.department, credit: c.credit, semester: c.semester, description: c.description || '' });
  };

  const remove = async (id) => {
    if (!confirm('Delete this course?')) return;
    try {
      await courseApi.remove(id);
      toast('Course deleted', 'success');
      qc.invalidateQueries({ queryKey: ['all-courses'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed (course may have files)', 'error');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Courses</h1>
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Course name" className="input" />
          <input required value={form.courseId} onChange={(e) => setForm({ ...form, courseId: e.target.value })} placeholder="Course ID (e.g. CSE-203)" className="input" />
          <select required value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="input">
            <option value="">Select department</option>
            {(departments?.data || []).map((d) => <option key={d._id} value={d._id}>{d.name} ({d.code})</option>)}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" min={0} value={form.credit} onChange={(e) => setForm({ ...form, credit: e.target.value })} placeholder="Credit" className="input" />
            <input value={form.semester} onChange={(e) => setForm({ ...form, semester: e.target.value })} placeholder="Semester" className="input" />
          </div>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" rows={3} className="input" />
          <button className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center justify-center gap-2">
            <Plus size={16} /> {editingId ? 'Update' : 'Add'} Course
          </button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm(empty); }} className="w-full h-9 text-sm text-slate-500">
              Cancel edit
            </button>
          )}
        </form>
      </div>

      <div className="lg:col-span-2 space-y-2">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by course name or course ID..."
            className="input"
            style={{ paddingLeft: '2.25rem' }}
          />
        </div>
        {isLoading ? (
          <p className="text-slate-400">Loading...</p>
        ) : (data?.data || []).length === 0 ? (
          <p className="text-slate-400">{q.trim() ? `No courses matched "${q.trim()}".` : 'No courses yet.'}</p>
        ) : (
          (data?.data || []).map((c) => (
            <div key={c._id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-700">{c.name} <span className="text-xs text-slate-400">({c.courseId})</span></p>
                <p className="text-sm text-slate-500 mt-0.5">{c.department?.name} &middot; {c.credit} credits &middot; {c.semester}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => edit(c)} className="p-2 rounded-md hover:bg-slate-100"><Pencil size={16} /></button>
                <button onClick={() => remove(c._id)} className="p-2 rounded-md hover:bg-red-50 text-red-600"><Trash2 size={16} /></button>
              </div>
            </div>
          ))
        )}
      </div>

      <style>{`.input { width: 100%; height: 2.5rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; }
      textarea.input { height: auto; padding: 0.6rem 0.75rem; }`}</style>
    </div>
  );
}
