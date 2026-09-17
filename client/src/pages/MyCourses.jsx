import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, X, BookOpen, Clock, CheckCircle2 } from 'lucide-react';
import { courseEnrollmentApi, courseApi, departmentApi, semesterApi, authApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';
import { formatDate } from '../utils/format.js';

const TYPE_LABELS = { regular: 'Regular', retake: 'Retake', extra: 'Extra', backlog: 'Backlog', improvement: 'Improvement', advance: 'Advance' };
const TYPE_STYLE = {
  regular: 'bg-slate-100 text-slate-600',
  retake: 'bg-amber-50 text-amber-700',
  extra: 'bg-sky-50 text-sky-700',
  backlog: 'bg-red-50 text-red-600',
  improvement: 'bg-emerald-50 text-emerald-700',
  advance: 'bg-purple-50 text-purple-700',
};
const STATUS_STYLE = {
  pending: 'bg-amber-50 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  active: 'bg-emerald-50 text-emerald-700',
  completed: 'bg-slate-100 text-slate-600',
  dropped: 'bg-red-50 text-red-600',
  rejected: 'bg-red-50 text-red-600',
};

// A type is student-requestable via /course-enrollments/request — 'regular'
// is administrative-only (bulk-enrolled or direct-created by staff).
const REQUESTABLE_TYPES = ['retake', 'extra', 'backlog', 'improvement', 'advance'];
const TYPE_FLAG = {
  retake: 'allowRetakeEnrollment',
  extra: 'allowExtraEnrollment',
  backlog: 'allowBacklogEnrollment',
  improvement: 'allowImprovementEnrollment',
  advance: 'allowAdvanceEnrollment',
};

export default function MyCourses() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showRequest, setShowRequest] = useState(false);
  const [additionalTab, setAdditionalTab] = useState('active');

  const { data: settings } = useQuery({ queryKey: ['public-settings'], queryFn: authApi.publicSettings });
  const { data, isLoading } = useQuery({ queryKey: ['my-course-enrollments'], queryFn: courseEnrollmentApi.my });

  const enrollmentSystemEnabled = !!settings?.data?.courseEnrollmentSystemEnabled;
  const allowedTypes = REQUESTABLE_TYPES.filter((t) => settings?.data?.[TYPE_FLAG[t]]);

  const enrollments = data?.data || [];
  const regular = enrollments.filter((e) => e.enrollmentType === 'regular' && ['active', 'approved'].includes(e.status));
  const additional = enrollments.filter((e) => e.enrollmentType !== 'regular');
  const additionalByTab = {
    active: additional.filter((e) => ['active', 'approved'].includes(e.status)),
    pending: additional.filter((e) => e.status === 'pending'),
    completed: additional.filter((e) => ['completed', 'dropped', 'rejected'].includes(e.status)),
  };
  const stats = [
    { label: 'Regular Courses', value: regular.length },
    { label: 'Additional Courses', value: additionalByTab.active.length },
    { label: 'Pending Requests', value: additionalByTab.pending.length },
    { label: 'Completed Additional', value: additional.filter((e) => e.status === 'completed').length },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-slate-800">My Courses</h1>
        {enrollmentSystemEnabled && (
          <button
            onClick={() => setShowRequest(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold"
          >
            <Plus size={16} /> Request Additional Course
          </button>
        )}
      </div>
      <p className="text-sm text-slate-500 mb-8">Your regular semester courses, plus any retake, extra, backlog, improvement, or advance enrollments.</p>

      {isLoading ? (
        <p className="text-slate-400">Loading...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {stats.map((s) => (
              <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="text-2xl font-bold text-slate-800">{s.value}</p>
                <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
              </div>
            ))}
          </div>

          <section className="mb-10">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen size={18} className="text-brand-600" />
              <h2 className="text-lg font-semibold text-slate-800">Regular Courses</h2>
            </div>
            <p className="text-xs text-slate-400 -mt-1 mb-3">
              The courses your department teaches, plus any regular enrollment recorded for you.
            </p>
            {regular.length === 0 ? (
              <p className="text-slate-400 text-sm">No regular courses on record yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {regular.map((e) => (
                  <EnrollmentCard key={e._id} enrollment={e} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-lg font-semibold text-slate-800 mb-3">Additional Courses</h2>
            <div className="flex gap-1 p-1 bg-slate-100 rounded-lg w-fit mb-4">
              {[
                { key: 'active', label: 'Active', icon: CheckCircle2 },
                { key: 'pending', label: 'Pending', icon: Clock },
                { key: 'completed', label: 'Completed', icon: BookOpen },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setAdditionalTab(t.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${
                    additionalTab === t.key ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'
                  }`}
                >
                  <t.icon size={14} /> {t.label} ({additionalByTab[t.key].length})
                </button>
              ))}
            </div>
            {additionalByTab[additionalTab].length === 0 ? (
              <p className="text-slate-400 text-sm">Nothing here yet.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {additionalByTab[additionalTab].map((e) => (
                  <EnrollmentCard key={e._id} enrollment={e} />
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {showRequest && (
        <RequestModal
          allowedTypes={allowedTypes}
          onClose={() => setShowRequest(false)}
          onSubmitted={() => {
            setShowRequest(false);
            qc.invalidateQueries({ queryKey: ['my-course-enrollments'] });
            toast('Request submitted — pending review', 'success');
          }}
        />
      )}
    </div>
  );
}

function EnrollmentCard({ enrollment: e }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-700 truncate">{e.course?.name}</p>
          <p className="text-xs text-slate-400">{e.course?.courseId} {e.course?.department?.code && `· ${e.course.department.code}`}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_STYLE[e.enrollmentType]}`}>{TYPE_LABELS[e.enrollmentType]}</span>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[e.status]}`}>{e.status}</span>
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-2">
        AY {e.academicYear} · {e.semester?.name}
        {e.batch?.name && ` · ${e.batch.name}`}
      </p>
      {e.reason && <p className="text-xs text-slate-500 mt-1 italic">"{e.reason}"</p>}
      {e.status === 'rejected' && e.history?.length > 0 && (
        <p className="text-xs text-red-500 mt-1">
          Rejected{e.history[e.history.length - 1]?.reason ? `: ${e.history[e.history.length - 1].reason}` : ''}
        </p>
      )}
      {/* A derived department course has no request behind it, so it has no
          request date to show. */}
      {!e.derived && <p className="text-[11px] text-slate-300 mt-2">Requested {formatDate(e.registeredAt)}</p>}
    </div>
  );
}

function RequestModal({ allowedTypes, onClose, onSubmitted }) {
  const { toast } = useToast();
  const [department, setDepartment] = useState('');
  const [form, setForm] = useState({ courseId: '', enrollmentType: allowedTypes[0] || '', academicYear: String(new Date().getFullYear()), semesterId: '', reason: '' });
  const [submitting, setSubmitting] = useState(false);

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data: courses } = useQuery({
    queryKey: ['courses-for-enrollment', department],
    queryFn: () => courseApi.list({ department: department || undefined, limit: 500 }),
  });
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.courseId) return toast('Select a course', 'error');
    if (!form.enrollmentType) return toast('Select an enrollment type', 'error');
    if (!form.semesterId) return toast('Select a semester', 'error');
    setSubmitting(true);
    try {
      await courseEnrollmentApi.request(form);
      onSubmitted();
    } catch (err) {
      toast(err.response?.data?.message || 'Request failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800">Request Additional Course</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100"><X size={18} /></button>
        </div>

        {allowedTypes.length === 0 ? (
          <p className="text-sm text-slate-500">No additional enrollment types are currently enabled. Contact your Admin.</p>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Department (optional filter)</label>
              <select value={department} onChange={(e) => setDepartment(e.target.value)} className="input">
                <option value="">All departments</option>
                {(departments?.data || []).map((d) => <option key={d._id} value={d._id}>{d.name} ({d.code})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Course</label>
              <SearchableSelect
                required
                value={form.courseId}
                onChange={(v) => setForm((f) => ({ ...f, courseId: v }))}
                placeholder="Search by name or code..."
                searchPlaceholder="Search courses..."
                options={(courses?.data || []).map((c) => ({ value: c._id, label: `${c.name} (${c.courseId})` }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Enrollment Type</label>
              <select required value={form.enrollmentType} onChange={(e) => setForm((f) => ({ ...f, enrollmentType: e.target.value }))} className="input">
                {allowedTypes.map((t) => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Academic Year</label>
                <input required value={form.academicYear} onChange={(e) => setForm((f) => ({ ...f, academicYear: e.target.value }))} className="input" placeholder="2026" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Semester</label>
                <select required value={form.semesterId} onChange={(e) => setForm((f) => ({ ...f, semesterId: e.target.value }))} className="input">
                  <option value="">Select</option>
                  {(semesters?.data || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Reason</label>
              <textarea required rows={3} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} className="input" placeholder="Why do you need this course?" />
            </div>
            <button disabled={submitting} className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold disabled:opacity-60">
              {submitting ? 'Submitting...' : 'Submit Request'}
            </button>
          </form>
        )}
      </div>
      <style>{`.input { width: 100%; height: 2.5rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; }
      textarea.input { height: auto; padding: 0.6rem 0.75rem; }`}</style>
    </div>
  );
}
