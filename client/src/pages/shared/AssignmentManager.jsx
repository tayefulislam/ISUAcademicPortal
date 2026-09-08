import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Paperclip, Users } from 'lucide-react';
import { assignmentApi, departmentApi, courseApi, batchApi, semesterApi, facultyApi } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/format.js';
import SubmissionsPanel from './SubmissionsPanel.jsx';

const SUBMISSION_TYPES = ['file', 'text', 'both'];
const STATUS_STYLE = { draft: 'bg-slate-100 text-slate-600', published: 'bg-emerald-50 text-emerald-700', closed: 'bg-red-50 text-red-600' };

const empty = {
  title: '',
  description: '',
  deadline: '',
  startDate: '',
  maxMarks: 100,
  submissionType: 'file',
  allowResubmission: true,
  status: 'draft',
  departments: [],
  courses: [],
  batches: [],
  semesters: [],
};

// Shared by Admin/Super Admin (unrestricted targeting) and Faculty (must
// target their own assigned Department/Course — enforced again server-side).
export default function AssignmentManager() {
  const { isFaculty } = useAuth();
  const [form, setForm] = useState(empty);
  const [attachments, setAttachments] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [grading, setGrading] = useState(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: allDepartments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list, enabled: !isFaculty });
  const { data: allCourses } = useQuery({ queryKey: ['all-courses'], queryFn: () => courseApi.list({ limit: 500 }), enabled: !isFaculty });
  const { data: facultyCourses } = useQuery({ queryKey: ['faculty-courses'], queryFn: facultyApi.courses, enabled: isFaculty });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });
  const { data, isLoading } = useQuery({ queryKey: ['my-assignments'], queryFn: assignmentApi.mine });

  const courses = isFaculty ? facultyCourses : allCourses;
  const departmentOptions = isFaculty
    ? [...new Map((facultyCourses?.data || []).map((c) => [c.department._id, c.department])).values()]
    : allDepartments?.data;

  const toggleIn = (key) => (id) => setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.departments.length && !form.courses.length && !form.batches.length && !form.semesters.length) {
      return toast('Select at least one department, course, batch, or semester to target', 'error');
    }
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => {
        if (Array.isArray(v)) v.forEach((item) => fd.append(k, item));
        else fd.append(k, v);
      });
      attachments.forEach((f) => fd.append('attachments', f));

      if (editingId) {
        await assignmentApi.update(editingId, fd);
        toast('Assignment updated', 'success');
      } else {
        await assignmentApi.create(fd);
        toast(form.status === 'published' ? 'Assignment published' : 'Assignment saved as draft', 'success');
      }
      setForm(empty);
      setAttachments([]);
      setEditingId(null);
      qc.invalidateQueries({ queryKey: ['my-assignments'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Save failed', 'error');
    }
  };

  const edit = (a) => {
    setEditingId(a._id);
    setForm({
      title: a.title,
      description: a.description,
      deadline: a.deadline ? a.deadline.slice(0, 16) : '',
      startDate: a.startDate ? a.startDate.slice(0, 16) : '',
      maxMarks: a.maxMarks,
      submissionType: a.submissionType,
      allowResubmission: a.allowResubmission,
      status: a.status,
      departments: (a.departments || []).map((d) => d._id || d),
      courses: (a.courses || []).map((c) => c._id || c),
      batches: (a.batches || []).map((b) => b._id || b),
      semesters: (a.semesters || []).map((s) => s._id || s),
    });
  };

  const remove = async (id) => {
    if (!confirm('Delete this assignment? All submissions will be removed too.')) return;
    try {
      await assignmentApi.remove(id);
      toast('Assignment deleted', 'success');
      qc.invalidateQueries({ queryKey: ['my-assignments'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed', 'error');
    }
  };

  const assignments = data?.data || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Assignments</h1>
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Title" className="input" />
          <textarea required rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" className="input" />

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Start date (optional)</label>
            <input type="datetime-local" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="input" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Deadline</label>
            <input required type="datetime-local" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} className="input" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input required type="number" min={0} value={form.maxMarks} onChange={(e) => setForm({ ...form, maxMarks: e.target.value })} placeholder="Max marks" className="input" />
            <select value={form.submissionType} onChange={(e) => setForm({ ...form, submissionType: e.target.value })} className="input">
              {SUBMISSION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.allowResubmission} onChange={(e) => setForm({ ...form, allowResubmission: e.target.checked })} />
            Allow resubmission before deadline
          </label>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Attachments (optional)</label>
            <input type="file" multiple onChange={(e) => setAttachments(Array.from(e.target.files || []))} className="input" />
          </div>

          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input">
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="closed">Closed</option>
          </select>

          <div className="space-y-3 border border-slate-200 rounded-lg p-3">
            <p className="text-xs text-slate-500">Target the exact class — all selected axes must match together.</p>
            <PickGroup label="Department" items={departmentOptions} value={form.departments} onToggle={toggleIn('departments')} />
            <PickGroup label="Course" items={courses?.data} value={form.courses} onToggle={toggleIn('courses')} labelKey="courseId" />
            <PickGroup label="Batch" items={batches?.data} value={form.batches} onToggle={toggleIn('batches')} />
            <PickGroup label="Semester" items={semesters?.data} value={form.semesters} onToggle={toggleIn('semesters')} />
          </div>

          <button className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center justify-center gap-2">
            <Plus size={16} /> {editingId ? 'Update' : 'Create'} Assignment
          </button>
          {editingId && (
            <button type="button" onClick={() => { setEditingId(null); setForm(empty); setAttachments([]); }} className="w-full h-9 text-sm text-slate-500">
              Cancel edit
            </button>
          )}
        </form>
      </div>

      <div className="lg:col-span-2 space-y-2">
        {isLoading ? (
          <p className="text-slate-400">Loading...</p>
        ) : assignments.length === 0 ? (
          <p className="text-slate-400">No assignments yet.</p>
        ) : (
          assignments.map((a) => (
            <div key={a._id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-700">{a.title}</p>
                  <p className="text-sm text-slate-500 mt-0.5">{a.description}</p>
                </div>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[a.status]}`}>{a.status}</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {[
                  a.departments?.map((d) => d.code).join(', '),
                  a.courses?.map((c) => c.courseId).join(', '),
                  a.batches?.map((b) => b.name).join(', '),
                  a.semesters?.map((s) => s.name).join(', '),
                ]
                  .filter(Boolean)
                  .join(' + ') || 'No target'}
                {' · '}Max {a.maxMarks} marks · Deadline {formatDate(a.deadline)}
              </p>
              {a.attachments?.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-1">
                  {a.attachments.map((att) => (
                    <a key={att._id} href={att.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">
                      <Paperclip size={12} /> {att.originalName}
                    </a>
                  ))}
                </div>
              )}
              <div className="flex gap-2 mt-3">
                <button onClick={() => edit(a)} className="p-1.5 rounded hover:bg-slate-100"><Pencil size={16} /></button>
                <button onClick={() => remove(a._id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={16} /></button>
                <button onClick={() => setGrading(a)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">
                  <Users size={14} /> Submissions
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {grading && <SubmissionsPanel assignment={grading} onClose={() => setGrading(null)} />}

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
