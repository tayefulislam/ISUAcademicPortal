import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { applicationAdminApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

const TYPES = ['REGISTRAR', 'HOD', 'DEAN', 'FACULTY', 'FINANCE', 'EXAM', 'ADMIN', 'OTHER'];
const BLANK = { name: '', designation: '', office: '', address: '', type: 'REGISTRAR', department: '', active: true, order: 0 };

// Admin: the official recipients applications are addressed to. A HOD record may
// be tied to one department, and the department's own head supplies the name —
// so "Head of Department" always means the real person on file.
export default function ApplicationRecipients() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data } = useQuery({ queryKey: ['admin-application-recipients'], queryFn: applicationAdminApi.listRecipients });
  const { data: deptData } = useQuery({ queryKey: ['admin-application-departments'], queryFn: applicationAdminApi.listDepartments });
  const recipients = data?.data || [];
  const departments = deptData?.data || [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-application-recipients'] });
    qc.invalidateQueries({ queryKey: ['admin-application-departments'] });
  };

  useEffect(() => { setForm(null); }, [data]);

  const save = async () => {
    if (!form?.name) return toast('A recipient name is required', 'error');
    setBusy(true);
    try {
      const payload = {
        name: form.name,
        designation: form.designation,
        office: form.office,
        address: form.address,
        type: form.type,
        department: form.department || null,
        active: form.active !== false,
        order: Number(form.order) || 0,
      };
      if (form._id) await applicationAdminApi.updateRecipient(form._id, payload);
      else await applicationAdminApi.createRecipient(payload);
      toast('Recipient saved', 'success');
      setForm(null);
      refresh();
    } catch (err) {
      toast(err.response?.data?.message || 'Could not save the recipient', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('Delete this recipient?')) return;
    try {
      await applicationAdminApi.deleteRecipient(id);
      toast('Deleted', 'success');
      refresh();
    } catch (err) {
      toast(err.response?.data?.message || 'Could not delete', 'error');
    }
  };

  const setHead = async (departmentId, head) => {
    try {
      await applicationAdminApi.setDepartmentHead(departmentId, head || null);
      toast('Department head updated', 'success');
      refresh();
    } catch (err) {
      toast(err.response?.data?.message || 'Could not update the head', 'error');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">Application Recipients</h1>
        <button onClick={() => setForm({ ...BLANK })} className="flex items-center gap-1.5 h-10 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700">
          <Plus size={15} /> New recipient
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {recipients.map((recipient) => (
          <div key={recipient._id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-700">{recipient.name} <span className="text-xs font-normal text-slate-400">{recipient.type}</span></p>
              <p className="text-xs text-slate-400">
                {[recipient.designation, recipient.office, recipient.department?.name].filter(Boolean).join(' · ') || 'No office set'}
                {recipient.active === false && ' · inactive'}
              </p>
            </div>
            <button onClick={() => setForm({ ...recipient, department: recipient.department?._id || '' })} className="text-xs font-semibold text-brand-600 hover:underline">Edit</button>
            <button onClick={() => remove(recipient._id)} className="p-2 text-slate-300 hover:text-red-600"><Trash2 size={15} /></button>
          </div>
        ))}
        {recipients.length === 0 && <p className="px-4 py-6 text-sm text-slate-400">No recipients yet.</p>}
      </div>

      {form && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-slate-700">{form._id ? 'Edit recipient' : 'New recipient'}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block"><span className="block text-xs font-medium text-slate-600 mb-1">Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" /></label>
            <label className="block"><span className="block text-xs font-medium text-slate-600 mb-1">Designation</span>
              <input value={form.designation || ''} onChange={(e) => setForm({ ...form, designation: e.target.value })} className="input" /></label>
            <label className="block"><span className="block text-xs font-medium text-slate-600 mb-1">Office / Department</span>
              <input value={form.office || ''} onChange={(e) => setForm({ ...form, office: e.target.value })} className="input" /></label>
            <label className="block"><span className="block text-xs font-medium text-slate-600 mb-1">Official address</span>
              <input value={form.address || ''} onChange={(e) => setForm({ ...form, address: e.target.value })} className="input" /></label>
            <label className="block"><span className="block text-xs font-medium text-slate-600 mb-1">Type</span>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input">
                {TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
              </select></label>
            <label className="block"><span className="block text-xs font-medium text-slate-600 mb-1">Department (HOD only)</span>
              <select value={form.department || ''} onChange={(e) => setForm({ ...form, department: e.target.value })} className="input">
                <option value="">University-wide</option>
                {departments.map((department) => <option key={department._id} value={department._id}>{department.name}</option>)}
              </select></label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active
          </label>
          <div className="flex gap-2">
            <button onClick={save} disabled={busy} className="flex items-center gap-2 h-10 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
              <Save size={15} /> {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setForm(null)} className="h-10 px-4 rounded-lg border border-slate-200 text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h2 className="font-semibold text-slate-700 mb-1">Department Heads</h2>
        <p className="text-xs text-slate-400 mb-3">
          Who a “Head of Department” application is addressed to. Leave unset and the HOD recipient’s own name is used.
        </p>
        <div className="space-y-2">
          {departments.map((department) => (
            <div key={department._id} className="flex items-center gap-3">
              <span className="w-56 text-sm text-slate-700 truncate">{department.name}</span>
              <input
                defaultValue={department.head?._id || ''}
                placeholder="Head user id (leave blank for none)"
                onBlur={(e) => {
                  if ((department.head?._id || '') !== e.target.value.trim()) setHead(department._id, e.target.value.trim());
                }}
                className="input flex-1"
              />
              <span className="text-xs text-slate-400 w-40 truncate">{department.head?.name || '—'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
