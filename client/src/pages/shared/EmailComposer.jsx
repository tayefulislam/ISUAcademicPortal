import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Mail, ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { emailApi, departmentApi, courseApi, batchApi, semesterApi, facultyApi } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/format.js';

const empty = { subject: '', body: '', everyone: false, includeFaculty: false, departments: [], courses: [], batches: [], semesters: [] };

// University Email System — compose + send a broadcast email to a targeted
// audience, and browse the send history. Targeting reuses the same
// AND-across-axes-free / OR-within-axis picker UI as Notices.
export default function EmailComposer() {
  const { isAdmin, isFaculty } = useAuth();
  const canTargetEveryone = isAdmin;
  const [form, setForm] = useState(empty);
  const [recipients, setRecipients] = useState([]); // individually-picked users, in addition to group targeting
  const [recipientSearch, setRecipientSearch] = useState('');
  const [showRecipientSearch, setShowRecipientSearch] = useState(false);
  const [expandedId, setExpandedId] = useState(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: allDepartments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list, enabled: !isFaculty });
  const { data: allCourses } = useQuery({ queryKey: ['all-courses'], queryFn: () => courseApi.list({ limit: 500 }), enabled: !isFaculty });
  const { data: facultyCourses } = useQuery({ queryKey: ['faculty-courses'], queryFn: facultyApi.courses, enabled: isFaculty });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });
  const { data: history, isLoading } = useQuery({ queryKey: ['email-history'], queryFn: emailApi.list });
  const { data: detail } = useQuery({ queryKey: ['email-detail', expandedId], queryFn: () => emailApi.get(expandedId), enabled: !!expandedId });
  const { data: contactResults } = useQuery({
    queryKey: ['email-contacts', recipientSearch],
    queryFn: () => emailApi.contacts(recipientSearch),
    enabled: showRecipientSearch,
  });

  const courses = isFaculty ? facultyCourses : allCourses;
  const departmentOptions = isFaculty
    ? [...new Map((facultyCourses?.data || []).map((c) => [c.department._id, c.department])).values()]
    : allDepartments?.data;

  const toggleIn = (key) => (id) => {
    setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));
  };

  const addRecipient = (contact) => {
    if (recipients.some((r) => r._id === contact._id)) return;
    setRecipients((r) => [...r, contact]);
  };
  const removeRecipient = (id) => setRecipients((r) => r.filter((x) => x._id !== id));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.everyone && !form.departments.length && !form.courses.length && !form.batches.length && !form.semesters.length && !recipients.length) {
      return toast('Select "Everyone", at least one target group, or an individual recipient', 'error');
    }
    if (!confirm('Send this email now? This cannot be undone.')) return;
    try {
      const res = await emailApi.send({ ...form, recipientIds: recipients.map((r) => r._id) });
      toast(res.message || 'Email sent', 'success');
      setForm(empty);
      setRecipients([]);
      qc.invalidateQueries({ queryKey: ['email-history'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Send failed', 'error');
    }
  };

  const historyList = history?.data || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Email Composer</h1>
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <input required value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Subject" className="input" />
          <textarea required rows={6} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder="Message body" className="input" />

          {canTargetEveryone && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.everyone} onChange={(e) => setForm({ ...form, everyone: e.target.checked, includeFaculty: false })} />
              Send to everyone (all active students)
            </label>
          )}
          {canTargetEveryone && !form.everyone && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.includeFaculty} onChange={(e) => setForm({ ...form, includeFaculty: e.target.checked })} />
              Also include Faculty in this send
            </label>
          )}

          {!form.everyone && (
            <div className="space-y-3 border border-slate-200 rounded-lg p-3">
              <PickGroup label="Department" items={departmentOptions} value={form.departments} onToggle={toggleIn('departments')} />
              <PickGroup label="Course" items={courses?.data} value={form.courses} onToggle={toggleIn('courses')} labelKey="courseId" />
              <PickGroup label="Batch" items={batches?.data} value={form.batches} onToggle={toggleIn('batches')} />
              <PickGroup label="Semester" items={semesters?.data} value={form.semesters} onToggle={toggleIn('semesters')} />
            </div>
          )}

          <div className="border border-slate-200 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-500">
              Individual recipient{isFaculty ? 's (your own students)' : 's (any student or faculty)'}
            </p>
            {recipients.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {recipients.map((r) => (
                  <span key={r._id} className="flex items-center gap-1 pl-2 pr-1 py-1 rounded-full text-xs font-medium bg-brand-50 text-brand-700">
                    {r.name}
                    <button type="button" onClick={() => removeRecipient(r._id)} className="hover:text-red-600">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={recipientSearch}
                onFocus={() => setShowRecipientSearch(true)}
                onChange={(e) => { setRecipientSearch(e.target.value); setShowRecipientSearch(true); }}
                placeholder="Search by name..."
                className="input pl-8"
              />
            </div>
            {showRecipientSearch && (
              <div className="max-h-32 overflow-y-auto border border-slate-100 rounded-lg divide-y divide-slate-50">
                {(contactResults?.data || []).map((c) => (
                  <button
                    type="button"
                    key={c._id}
                    onClick={() => addRecipient(c)}
                    className="w-full text-left px-2.5 py-1.5 text-sm hover:bg-slate-50 flex items-center justify-between"
                  >
                    <span>{c.name} <span className="text-xs text-slate-400 capitalize">({c.role})</span></span>
                  </button>
                ))}
                {!contactResults?.data?.length && <p className="text-xs text-slate-400 px-2.5 py-1.5">No matches</p>}
              </div>
            )}
          </div>

          <button className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center justify-center gap-2">
            <Send size={16} /> Send Email
          </button>
        </form>
      </div>

      <div className="lg:col-span-2 space-y-2">
        <h2 className="text-lg font-semibold text-slate-700 flex items-center gap-2"><Mail size={18} /> Send History</h2>
        {isLoading ? (
          <p className="text-slate-400">Loading...</p>
        ) : historyList.length === 0 ? (
          <p className="text-slate-400">No emails sent yet.</p>
        ) : (
          historyList.map((log) => (
            <div key={log._id} className="bg-white border border-slate-200 rounded-xl p-4">
              <button type="button" className="w-full flex items-start justify-between gap-2 text-left" onClick={() => setExpandedId(expandedId === log._id ? null : log._id)}>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-700">{log.subject}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    By {log.createdBy?.name} · {formatDate(log.createdAt)} · {log.successCount}/{log.totalRecipients} delivered
                    {log.failCount > 0 && <span className="text-red-500"> · {log.failCount} failed</span>}
                  </p>
                </div>
                {expandedId === log._id ? <ChevronUp size={18} className="shrink-0 text-slate-400" /> : <ChevronDown size={18} className="shrink-0 text-slate-400" />}
              </button>
              {expandedId === log._id && detail?.data && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{detail.data.body}</p>
                  <p className="text-xs font-semibold text-slate-500 mt-3 mb-1">Recipients ({detail.data.recipients?.length || 0})</p>
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {(detail.data.recipients || []).map((r, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-slate-600">{r.email}</span>
                        <span className={r.status === 'sent' ? 'text-emerald-600' : 'text-red-500'}>{r.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <style>{`.input { width: 100%; height: 2.5rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; }
      textarea.input { height: auto; padding: 0.6rem 0.75rem; }`}</style>
    </div>
  );
}

function PickGroup({ label, items, value, onToggle, labelKey = 'name' }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
        {(items || []).map((item) => (
          <button
            type="button"
            key={item._id}
            onClick={() => onToggle(item._id)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
              value.includes(item._id) ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-300 text-slate-600'
            }`}
          >
            {item[labelKey] || item.name}
          </button>
        ))}
        {!items?.length && <span className="text-xs text-slate-400">None available</span>}
      </div>
    </div>
  );
}
