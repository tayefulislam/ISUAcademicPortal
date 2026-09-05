import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil } from 'lucide-react';
import { departmentApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

const empty = { name: '', code: '', description: '' };

export default function AdminDepartments() {
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await departmentApi.update(editingId, form);
        toast('Department updated', 'success');
      } else {
        await departmentApi.create(form);
        toast('Department created', 'success');
      }
      setForm(empty);
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['departments'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Save failed', 'error');
    }
  };

  const edit = (d) => {
    setEditingId(d._id);
    setForm({ name: d.name, code: d.code, description: d.description || '' });
  };

  const remove = async (id) => {
    if (!confirm('Delete this department?')) return;
    try {
      await departmentApi.remove(id);
      toast('Department deleted', 'success');
      qc.invalidateQueries({ queryKey: ['departments'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed (department may have files)', 'error');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Departments</h1>
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Department name" className="input" />
          <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Code (e.g. CSE)" className="input" />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" rows={3} className="input" />
          <button className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center justify-center gap-2">
            <Plus size={16} /> {editingId ? 'Update' : 'Add'} Department
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
        ) : (
          (data?.data || []).map((d) => (
            <div key={d._id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-700">{d.name} <span className="text-xs text-slate-400">({d.code})</span></p>
                {d.description && <p className="text-sm text-slate-500 mt-0.5">{d.description}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => edit(d)} className="p-2 rounded-md hover:bg-slate-100"><Pencil size={16} /></button>
                <button onClick={() => remove(d._id)} className="p-2 rounded-md hover:bg-red-50 text-red-600"><Trash2 size={16} /></button>
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
