import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { semesterApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

const empty = { name: '', code: '' };

export default function AdminSemesters() {
  const [form, setForm] = useState(empty);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });

  const submit = async (e) => {
    e.preventDefault();
    try {
      await semesterApi.create(form);
      toast('Semester created', 'success');
      setForm(empty);
      qc.invalidateQueries({ queryKey: ['semesters'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Save failed', 'error');
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this semester?')) return;
    try {
      await semesterApi.remove(id);
      toast('Semester deleted', 'success');
      qc.invalidateQueries({ queryKey: ['semesters'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed (semester may be in use)', 'error');
    }
  };

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-slate-800 mb-4">Semesters</h1>
      <form onSubmit={submit} className="flex gap-2 mb-6">
        <input
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Name (e.g. 1st Semester)"
          className="flex-1 h-10 rounded-lg border border-slate-300 px-3 text-sm"
        />
        <input
          required
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          placeholder="Code (e.g. SEM-1)"
          className="w-32 h-10 rounded-lg border border-slate-300 px-3 text-sm"
        />
        <button className="px-4 h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center gap-1.5">
          <Plus size={16} /> Add
        </button>
      </form>

      {isLoading ? (
        <p className="text-slate-400">Loading...</p>
      ) : (
        <div className="space-y-2">
          {(data?.data || []).map((s) => (
            <div key={s._id} className="bg-white border border-slate-200 rounded-lg p-3 flex items-center justify-between">
              <span className="font-medium text-slate-700">
                {s.name} <span className="text-xs text-slate-400">({s.code})</span>
              </span>
              <button onClick={() => remove(s._id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
