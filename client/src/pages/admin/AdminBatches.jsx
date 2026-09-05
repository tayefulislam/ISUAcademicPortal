import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { batchApi, departmentApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

const empty = { name: '', code: '', department: '', year: '' };

export default function AdminBatches() {
  const [form, setForm] = useState(empty);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data, isLoading } = useQuery({ queryKey: ['all-batches'], queryFn: () => batchApi.list() });

  const submit = async (e) => {
    e.preventDefault();
    try {
      await batchApi.create({ ...form, department: form.department || undefined, year: form.year || undefined });
      toast('Batch created', 'success');
      setForm(empty);
      qc.invalidateQueries({ queryKey: ['all-batches'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Save failed', 'error');
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this batch?')) return;
    try {
      await batchApi.remove(id);
      toast('Batch deleted', 'success');
      qc.invalidateQueries({ queryKey: ['all-batches'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed (batch may have files)', 'error');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Batches</h1>
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name (e.g. BATCH-14)" className="input" />
          <input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Code (e.g. BATCH-14)" className="input" />
          <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="input">
            <option value="">No specific department</option>
            {(departments?.data || []).map((d) => <option key={d._id} value={d._id}>{d.name} ({d.code})</option>)}
          </select>
          <input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="Year" className="input" />
          <button className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center justify-center gap-2">
            <Plus size={16} /> Add Batch
          </button>
        </form>
      </div>

      <div className="lg:col-span-2">
        {isLoading ? (
          <p className="text-slate-400">Loading...</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {(data?.data || []).map((b) => (
              <div key={b._id} className="bg-white border border-slate-200 rounded-lg p-3 flex items-center justify-between">
                <span className="font-medium text-slate-700 text-sm">{b.name}</span>
                <button onClick={() => remove(b._id)} className="p-1 rounded hover:bg-red-50 text-red-600"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`.input { width: 100%; height: 2.5rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; }`}</style>
    </div>
  );
}
