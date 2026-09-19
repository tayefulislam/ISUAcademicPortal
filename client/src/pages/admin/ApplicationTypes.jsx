import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { applicationAdminApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

const BLANK_FIELD = { key: '', label: '', type: 'TEXT', required: false, options: '' };
const FIELD_TYPES = ['TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN'];

// Admin: the application types and the extra questions each one asks. Nothing
// here is hard-coded in the client — the whole vocabulary lives in the database.
export default function ApplicationTypes() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({ queryKey: ['admin-application-types'], queryFn: applicationAdminApi.listTypes });
  const types = data?.data || [];

  useEffect(() => {
    const found = types.find((type) => type._id === selectedId);
    if (found && !form) {
      setForm({
        ...found,
        fields: (found.fields || []).map((field) => ({ ...field, options: (field.options || []).join(', ') })),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, types]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-application-types'] });

  const startNew = () => {
    setSelectedId('');
    setForm({
      key: '', name: '', description: '', order: types.length + 1, active: true,
      defaultInstructions: '', template: { salutation: 'Dear Sir/Madam,', closing: 'I shall be grateful for your kind consideration.' },
      fields: [],
    });
  };

  const save = async () => {
    if (!form?.key || !form?.name) return toast('A key and a name are required', 'error');
    setBusy(true);
    try {
      const payload = {
        key: form.key,
        name: form.name,
        description: form.description,
        order: Number(form.order) || 0,
        active: form.active !== false,
        defaultInstructions: form.defaultInstructions,
        template: form.template || {},
        fields: (form.fields || []).map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          required: Boolean(field.required),
          options: field.type === 'SELECT'
            ? String(field.options || '').split(',').map((o) => o.trim()).filter(Boolean)
            : [],
        })),
      };
      if (form._id) await applicationAdminApi.updateType(form._id, payload);
      else await applicationAdminApi.createType(payload);
      toast('Application type saved', 'success');
      setForm(null);
      refresh();
    } catch (err) {
      toast(err.response?.data?.message || 'Could not save the type', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this application type?')) return;
    try {
      await applicationAdminApi.deleteType(id);
      toast('Deleted', 'success');
      setSelectedId('');
      setForm(null);
      refresh();
    } catch (err) {
      toast(err.response?.data?.message || 'Could not delete', 'error');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-5">
      <aside className="bg-white border border-slate-200 rounded-xl p-4 h-fit">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-700">Application Types</h2>
          <button onClick={startNew} className="p-1.5 rounded-md text-brand-600 hover:bg-brand-50" title="New type"><Plus size={16} /></button>
        </div>
        <div className="space-y-1 max-h-[70vh] overflow-y-auto">
          {types.map((type) => (
            <button
              key={type._id}
              onClick={() => { setSelectedId(type._id); setForm(null); }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm ${type._id === selectedId ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {type.name}
              {type.active === false && <span className="ml-2 text-[10px] text-slate-400">inactive</span>}
            </button>
          ))}
        </div>
      </aside>

      <section className="bg-white border border-slate-200 rounded-xl p-5">
        {!form ? (
          <p className="text-sm text-slate-400">Select a type to edit, or create a new one.</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block"><span className="block text-xs font-medium text-slate-600 mb-1">Key (slug)</span>
                <input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} className="input" /></label>
              <label className="block"><span className="block text-xs font-medium text-slate-600 mb-1">Name</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" /></label>
            </div>
            <label className="block"><span className="block text-xs font-medium text-slate-600 mb-1">Description</span>
              <input value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} className="input" /></label>
            <label className="block"><span className="block text-xs font-medium text-slate-600 mb-1">Default instructions to the AI</span>
              <textarea rows={2} value={form.defaultInstructions || ''} onChange={(e) => setForm({ ...form, defaultInstructions: e.target.value })} className="input py-2" /></label>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                Order <input type="number" value={form.order ?? 0} onChange={(e) => setForm({ ...form, order: e.target.value })} className="input w-24" />
              </label>
            </div>

            <div className="border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-slate-700">Extra questions</h3>
                <button onClick={() => setForm({ ...form, fields: [...(form.fields || []), { ...BLANK_FIELD }] })} className="text-xs font-semibold text-brand-600 hover:underline">Add question</button>
              </div>
              <div className="space-y-2">
                {(form.fields || []).map((field, index) => (
                  <div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_130px_90px_1fr_40px] gap-2 items-center">
                    <input placeholder="key" value={field.key} onChange={(e) => {
                      const fields = [...form.fields]; fields[index] = { ...field, key: e.target.value }; setForm({ ...form, fields });
                    }} className="input" />
                    <input placeholder="Label" value={field.label} onChange={(e) => {
                      const fields = [...form.fields]; fields[index] = { ...field, label: e.target.value }; setForm({ ...form, fields });
                    }} className="input" />
                    <select value={field.type} onChange={(e) => {
                      const fields = [...form.fields]; fields[index] = { ...field, type: e.target.value }; setForm({ ...form, fields });
                    }} className="input">
                      {FIELD_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                    </select>
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      <input type="checkbox" checked={Boolean(field.required)} onChange={(e) => {
                        const fields = [...form.fields]; fields[index] = { ...field, required: e.target.checked }; setForm({ ...form, fields });
                      }} /> Req
                    </label>
                    <input
                      placeholder={field.type === 'SELECT' ? 'options, comma separated' : ''}
                      value={field.options || ''}
                      disabled={field.type !== 'SELECT'}
                      onChange={(e) => {
                        const fields = [...form.fields]; fields[index] = { ...field, options: e.target.value }; setForm({ ...form, fields });
                      }}
                      className="input disabled:bg-slate-50"
                    />
                    <button onClick={() => setForm({ ...form, fields: form.fields.filter((_, i) => i !== index) })} className="p-2 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={save} disabled={busy} className="flex items-center gap-2 h-10 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
                <Save size={15} /> {busy ? 'Saving…' : 'Save'}
              </button>
              {form._id && (
                <button onClick={() => remove(form._id)} className="h-10 px-4 rounded-lg border border-slate-200 text-sm text-slate-500 hover:bg-red-50 hover:text-red-600">Delete</button>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
