import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Paperclip } from 'lucide-react';
import { noticeApi, departmentApi, courseApi, batchApi, semesterApi, facultyApi } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/format.js';

const TYPES = ['notice', 'announcement', 'update', 'exam', 'assignment'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const PRIORITY_STYLE = { low: 'bg-slate-100 text-slate-600', normal: 'bg-brand-50 text-brand-700', high: 'bg-amber-50 text-amber-700', urgent: 'bg-red-50 text-red-600' };

const empty = {
  title: '',
  description: '',
  type: 'notice',
  priority: 'normal',
  expiryDate: '',
  everyone: false,
  departments: [],
  courses: [],
  batches: [],
  semesters: [],
};

// Shared by Admin/Super Admin ("everyone" allowed) and Faculty (must target
// their own assigned Department/Course — enforced again server-side).
export default function NoticeManager() {
  const { user, isAdmin, isFaculty } = useAuth();
  const canTargetEveryone = isAdmin; // admin or super_admin
  const [form, setForm] = useState(empty);
  const [attachment, setAttachment] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: allDepartments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list, enabled: !isFaculty });
  const { data: allCourses } = useQuery({ queryKey: ['all-courses'], queryFn: () => courseApi.list({ limit: 500 }), enabled: !isFaculty });
  const { data: facultyCourses } = useQuery({ queryKey: ['faculty-courses'], queryFn: facultyApi.courses, enabled: isFaculty });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });
  const { data, isLoading } = useQuery({ queryKey: ['my-notices'], queryFn: noticeApi.mine });

  // Faculty can only target their own assigned departments/courses — scope
  // the pickers to match what the backend will actually accept.
  const courses = isFaculty ? facultyCourses : allCourses;
  const departmentOptions = isFaculty
    ? [...new Map((facultyCourses?.data || []).map((c) => [c.department._id, c.department])).values()]
    : allDepartments?.data;

  const toggleIn = (key) => (id) => {
    setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.everyone && !form.departments.length && !form.courses.length && !form.batches.length && !form.semesters.length) {
      return toast('Select "Everyone" or at least one target group', 'error');
    }
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (Array.isArray(v)) v.forEach((item) => fd.append(k, item));
        else fd.append(k, v);
      });
      if (attachment) fd.append('attachment', attachment);

      if (editingId) {
        await noticeApi.update(editingId, fd);
        toast('Notice updated', 'success');
      } else {
        await noticeApi.create(fd);
        toast('Notice published', 'success');
      }
      setForm(empty);
      setAttachment(null);
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['my-notices'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Save failed', 'error');
    }
  };

  const edit = (n) => {
    setEditingId(n._id);
    setForm({
      title: n.title,
      description: n.description,
      type: n.type,
      priority: n.priority,
      expiryDate: n.expiryDate ? n.expiryDate.slice(0, 10) : '',
      everyone: n.targeting.everyone,
      departments: (n.targeting.departments || []).map((d) => d._id || d),
      courses: (n.targeting.courses || []).map((c) => c._id || c),
      batches: (n.targeting.batches || []).map((b) => b._id || b),
      semesters: (n.targeting.semesters || []).map((s) => s._id || s),
    });
  };

  const remove = async (id) => {
    if (!confirm('Delete this notice?')) return;
    try {
      await noticeApi.remove(id);
      toast('Notice deleted', 'success');
      qc.invalidateQueries({ queryKey: ['my-notices'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed', 'error');
    }
  };

  const notices = data?.data || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Notices & Announcements</h1>
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" className="input" />
          <textarea required rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" className="input" />

          <div className="grid grid-cols-2 gap-2">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input">
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="input">
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Expiry date (optional)</label>
            <input type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} className="input" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Attachment (optional)</label>
            <input type="file" onChange={(e) => setAttachment(e.target.files?.[0] || null)} className="input" />
          </div>

          {canTargetEveryone && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.everyone} onChange={(e) => setForm({ ...form, everyone: e.target.checked })} />
              Target everyone
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

          <button className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center justify-center gap-2">
            <Plus size={16} /> {editingId ? 'Update' : 'Publish'} Notice
          </button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm(empty); setAttachment(null); }} className="w-full h-9 text-sm text-slate-500">
              Cancel edit
            </button>
          )}
        </form>
      </div>

      <div className="lg:col-span-2 space-y-2">
        {isLoading ? (
          <p className="text-slate-400">Loading...</p>
        ) : notices.length === 0 ? (
          <p className="text-slate-400">No notices yet.</p>
        ) : (
          notices.map((n) => (
            <div key={n._id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-700">{n.title}</p>
                  <p className="text-sm text-slate-500 mt-0.5">{n.description}</p>
                </div>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_STYLE[n.priority]}`}>{n.priority}</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {n.targeting.everyone
                  ? 'Everyone'
                  : [
                      n.targeting.departments?.map((d) => d.code).join(', '),
                      n.targeting.courses?.map((c) => c.courseId).join(', '),
                      n.targeting.batches?.map((b) => b.name).join(', '),
                      n.targeting.semesters?.map((s) => s.name).join(', '),
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No target'}
                {' · '}Published {formatDate(n.publishDate)}
                {n.expiryDate && <> · Expires {formatDate(n.expiryDate)}</>}
              </p>
              {n.attachmentUrl && (
                <a href={n.attachmentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline mt-1">
                  <Paperclip size={12} /> {n.attachmentName || 'Attachment'}
                </a>
              )}
              <div className="flex gap-2 mt-3">
                <button onClick={() => edit(n)} className="p-1.5 rounded hover:bg-slate-100"><Pencil size={16} /></button>
                <button onClick={() => remove(n._id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={16} /></button>
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
