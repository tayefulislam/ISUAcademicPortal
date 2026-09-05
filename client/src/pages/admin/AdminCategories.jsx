import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { categoryApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

export default function AdminCategories() {
  const [name, setName] = useState('');
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['categories'], queryFn: categoryApi.list });

  const submit = async (e) => {
    e.preventDefault();
    try {
      await categoryApi.create({ name });
      toast('Category created', 'success');
      setName('');
      qc.invalidateQueries({ queryKey: ['categories'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Save failed', 'error');
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this category?')) return;
    try {
      await categoryApi.remove(id);
      toast('Category deleted', 'success');
      qc.invalidateQueries({ queryKey: ['categories'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed (category may have files)', 'error');
    }
  };

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold text-slate-800 mb-4">Categories</h1>
      <form onSubmit={submit} className="flex gap-2 mb-6">
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New category name"
          className="flex-1 h-10 rounded-lg border border-slate-300 px-3 text-sm"
        />
        <button className="px-4 h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center gap-1.5">
          <Plus size={16} /> Add
        </button>
      </form>

      {isLoading ? (
        <p className="text-slate-400">Loading...</p>
      ) : (
        <div className="space-y-2">
          {(data?.data || []).map((c) => (
            <div key={c._id} className="bg-white border border-slate-200 rounded-lg p-3 flex items-center justify-between">
              <span className="font-medium text-slate-700">{c.name}</span>
              <button onClick={() => remove(c._id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={16} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
