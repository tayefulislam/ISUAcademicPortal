import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { departmentApi, courseApi, chapterApi, topicApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

const empty = { name: '', chapterId: '', order: 0 };

export default function AdminTopics() {
  const [department, setDepartment] = useState('');
  const [course, setCourse] = useState('');
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
  const { data: chapters } = useQuery({
    queryKey: ['chapters', course],
    queryFn: () => chapterApi.list({ course }),
    enabled: !!course,
  });
  const { data, isLoading } = useQuery({
    queryKey: ['topics', form.chapterId],
    queryFn: () => topicApi.list({ chapter: form.chapterId }),
    enabled: !!form.chapterId,
  });

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await topicApi.update(editingId, { name: form.name, order: form.order });
        toast('Topic updated', 'success');
      } else {
        await topicApi.create(form);
        toast('Topic created', 'success');
      }
      setForm((f) => ({ ...empty, chapterId: f.chapterId }));
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['topics'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Save failed', 'error');
    }
  };

  const edit = (t) => {
    setEditingId(t._id);
    setForm({ name: t.name, chapterId: t.chapter, order: t.order || 0 });
  };

  const remove = async (id) => {
    if (!confirm('Delete this topic?')) return;
    try {
      await topicApi.remove(id);
      toast('Topic deleted', 'success');
      qc.invalidateQueries({ queryKey: ['topics'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed (topic may have files)', 'error');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Topics</h1>
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 mb-4">
          <select value={department} onChange={(e) => { setDepartment(e.target.value); setCourse(''); setForm(empty); }} className="input">
            <option value="">Select department</option>
            {(departments?.data || []).map((d) => <option key={d._id} value={d._id}>{d.name} ({d.code})</option>)}
          </select>
          <select value={course} onChange={(e) => { setCourse(e.target.value); setForm(empty); }} className="input" disabled={!department}>
            <option value="">Select course</option>
            {(courses?.data || []).map((c) => <option key={c._id} value={c._id}>{c.name} ({c.courseId})</option>)}
          </select>
        </div>

        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <select
            required
            value={form.chapterId}
            onChange={(e) => { setForm({ ...empty, chapterId: e.target.value }); setEditingId(null); }}
            className="input"
            disabled={!course}
          >
            <option value="">Select chapter</option>
            {(chapters?.data || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Topic name" className="input" disabled={!form.chapterId} />
          <input type="number" value={form.order} onChange={(e) => setForm({ ...form, order: Number(e.target.value) })} placeholder="Display order" className="input" disabled={!form.chapterId} />
          <button disabled={!form.chapterId} className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
            <Plus size={16} /> {editingId ? 'Update' : 'Add'} Topic
          </button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm((f) => ({ ...empty, chapterId: f.chapterId })); }} className="w-full h-9 text-sm text-slate-500">
              Cancel edit
            </button>
          )}
        </form>
      </div>

      <div className="lg:col-span-2 space-y-2">
        {!form.chapterId ? (
          <p className="text-slate-400">Pick a department, course, and chapter to manage its topics.</p>
        ) : isLoading ? (
          <p className="text-slate-400">Loading...</p>
        ) : (
          (data?.data || []).map((t) => (
            <div key={t._id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
              <p className="font-semibold text-slate-700">{t.name} <span className="text-xs text-slate-400">(order {t.order})</span></p>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => edit(t)} className="p-2 rounded-md hover:bg-slate-100"><Pencil size={16} /></button>
                <button onClick={() => remove(t._id)} className="p-2 rounded-md hover:bg-red-50 text-red-600"><Trash2 size={16} /></button>
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
