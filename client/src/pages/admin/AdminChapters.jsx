import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { departmentApi, courseApi, chapterApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

const empty = { name: '', course: '', order: 0 };

export default function AdminChapters() {
  const [department, setDepartment] = useState('');
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data: courses } = useQuery({
    queryKey: ['courses', department],
    queryFn: () => courseApi.list({ department, limit: 200 }),
    enabled: !!department,
  });
  const { data, isLoading } = useQuery({
    queryKey: ['chapters', form.course],
    queryFn: () => chapterApi.list({ course: form.course }),
    enabled: !!form.course,
  });

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await chapterApi.update(editingId, form);
        toast('Chapter updated', 'success');
      } else {
        await chapterApi.create(form);
        toast('Chapter created', 'success');
      }
      setForm((f) => ({ ...empty, course: f.course }));
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['chapters'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Save failed', 'error');
    }
  };

  const edit = (c) => {
    setEditingId(c._id);
    setForm({ name: c.name, course: c.course, order: c.order || 0 });
  };

  const remove = async (id) => {
    if (!confirm('Delete this chapter?')) return;
    try {
      await chapterApi.remove(id);
      toast('Chapter deleted', 'success');
      qc.invalidateQueries({ queryKey: ['chapters'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed (chapter may have files)', 'error');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Chapters</h1>
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 mb-4">
          <select value={department} onChange={(e) => setDepartment(e.target.value)} className="input">
            <option value="">Select department</option>
            {(departments?.data || []).map((d) => <option key={d._id} value={d._id}>{d.name} ({d.code})</option>)}
          </select>
        </div>

        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <select
            required
            value={form.course}
            onChange={(e) => { setForm({ ...empty, course: e.target.value }); setEditingId(null); }}
            className="input"
            disabled={!department}
          >
            <option value="">Select course</option>
            {(courses?.data || []).map((c) => <option key={c._id} value={c._id}>{c.name} ({c.courseId})</option>)}
          </select>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Chapter name" className="input" disabled={!form.course} />
          <input type="number" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} placeholder="Display order" className="input" disabled={!form.course} />
          <button disabled={!form.course} className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
            <Plus size={16} /> {editingId ? 'Update' : 'Add'} Chapter
          </button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm((f) => ({ ...empty, course: f.course })); }} className="w-full h-9 text-sm text-slate-500">
              Cancel edit
            </button>
          )}
        </form>
      </div>

      <div className="lg:col-span-2 space-y-2">
        {!form.course ? (
          <p className="text-slate-400">Pick a department and course to manage its chapters.</p>
        ) : isLoading ? (
          <p className="text-slate-400">Loading...</p>
        ) : (
          (data?.data || []).map((c) => (
            <div key={c._id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
              <p className="font-semibold text-slate-700">{c.name} <span className="text-xs text-slate-400">(order {c.order})</span></p>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => edit(c)} className="p-2 rounded-md hover:bg-slate-100"><Pencil size={16} /></button>
                <button onClick={() => remove(c._id)} className="p-2 rounded-md hover:bg-red-50 text-red-600"><Trash2 size={16} /></button>
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
