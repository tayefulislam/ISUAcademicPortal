import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X, Play, CheckCircle2, LogOut, History, Trash2, Plus, Users } from 'lucide-react';
import { courseEnrollmentApi, courseApi, batchApi, semesterApi, superAdminApi } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/format.js';

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
  approved: 'bg-sky-50 text-sky-700',
  active: 'bg-emerald-50 text-emerald-700',
  completed: 'bg-slate-100 text-slate-600',
  dropped: 'bg-red-50 text-red-600',
  rejected: 'bg-red-50 text-red-600',
};
const STUDENT_REQUESTABLE_TYPES = ['retake', 'extra', 'backlog', 'improvement', 'advance'];

// Shared by Faculty, Admin-tier roles (with the 'enrollments' permission),
// and Super Admin/Administrator — the server scopes what each actually
// sees/can act on (courseEnrollmentController.js's scopeFilter).
// Create-Direct/Bulk-Enroll are gated to Super Admin/Administrator client-side
// because student search only exists on GET /super-admin/users (a
// Super-Admin-tier route) — everything else (filter/approve/reject/
// activate/complete/drop/history) works for anyone with 'enrollments'
// access, scoped server-side to their own courses.
export default function EnrollmentManager() {
  const { isSuperAdminTier } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [filters, setFilters] = useState({ status: '', enrollmentType: '', course: '', batch: '', semester: '' });
  const [page, setPage] = useState(1);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [expandedHistory, setExpandedHistory] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);

  const params = { ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), page, limit: 20 };
  const { data, isLoading } = useQuery({
    queryKey: ['enrollments', params],
    queryFn: () => courseEnrollmentApi.list(params),
  });
  // Picker: the whole catalogue is needed, then filtered client-side.
  const { data: courseData } = useQuery({ queryKey: ['courses-lite'], queryFn: () => courseApi.list({ limit: 500 }) });
  const { data: batchData } = useQuery({ queryKey: ['batches-lite'], queryFn: () => batchApi.list() });
  const { data: semesterData } = useQuery({ queryKey: ['semesters-lite'], queryFn: semesterApi.list });

  const enrollments = data?.data || [];
  const pagination = data?.pagination || { page: 1, pages: 1, total: 0 };
  const courses = courseData?.data || courseData || [];
  const batches = batchData?.data || batchData || [];
  const semesters = semesterData?.data || semesterData || [];

  const invalidate = () => qc.invalidateQueries({ queryKey: ['enrollments'] });

  const setFilter = (key, value) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const runAction = async (fn, successMsg) => {
    try {
      await fn();
      toast(successMsg, 'success');
      invalidate();
    } catch (err) {
      toast(err.response?.data?.message || 'Action failed', 'error');
    }
  };

  const submitReject = async (e) => {
    e.preventDefault();
    await runAction(() => courseEnrollmentApi.reject(rejecting, rejectReason), 'Enrollment rejected');
    setRejecting(null);
    setRejectReason('');
  };

  const removeEnrollment = async (id) => {
    if (!window.confirm('Permanently delete this enrollment record? This cannot be undone.')) return;
    await runAction(() => courseEnrollmentApi.remove(id), 'Enrollment deleted');
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Course Enrollment</h1>
          <p className="text-sm text-slate-500">Search, filter, and manage regular and additional-course enrollments.</p>
        </div>
        {isSuperAdminTier && (
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setShowBulk(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Users size={15} /> Bulk Enroll Batch
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
            >
              <Plus size={15} /> Create Enrollment
            </button>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 my-4">
        <select value={filters.status} onChange={(e) => setFilter('status', e.target.value)} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
          <option value="">All statuses</option>
          {Object.keys(STATUS_STYLE).map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
        <select
          value={filters.enrollmentType}
          onChange={(e) => setFilter('enrollmentType', e.target.value)}
          className="h-9 rounded-lg border border-slate-300 px-2 text-sm"
        >
          <option value="">All types</option>
          {Object.entries(TYPE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select value={filters.course} onChange={(e) => setFilter('course', e.target.value)} className="h-9 rounded-lg border border-slate-300 px-2 text-sm max-w-[180px]">
          <option value="">All courses</option>
          {courses.map((c) => (
            <option key={c._id} value={c._id}>
              {c.courseId} — {c.name}
            </option>
          ))}
        </select>
        <select value={filters.batch} onChange={(e) => setFilter('batch', e.target.value)} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
          <option value="">All batches</option>
          {batches.map((b) => (
            <option key={b._id} value={b._id}>
              {b.name}
            </option>
          ))}
        </select>
        <select value={filters.semester} onChange={(e) => setFilter('semester', e.target.value)} className="h-9 rounded-lg border border-slate-300 px-2 text-sm">
          <option value="">All semesters</option>
          {semesters.map((s) => (
            <option key={s._id} value={s._id}>
              {s.name}
            </option>
          ))}
        </select>
        {Object.values(filters).some(Boolean) && (
          <button
            onClick={() => {
              setFilters({ status: '', enrollmentType: '', course: '', batch: '', semester: '' });
              setPage(1);
            }}
            className="h-9 px-3 rounded-lg text-sm text-slate-500 hover:text-slate-700"
          >
            Clear
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-slate-400">Loading...</p>
      ) : enrollments.length === 0 ? (
        <p className="text-slate-400">No enrollments match these filters.</p>
      ) : (
        <div className="space-y-3">
          {enrollments.map((e) => (
            <div key={e._id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-slate-700">
                      {e.course?.name} ({e.course?.courseId})
                    </p>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_STYLE[e.enrollmentType]}`}>{TYPE_LABELS[e.enrollmentType]}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[e.status]}`}>{e.status}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {e.student?.name} ({e.student?.email}) &middot; AY {e.academicYear} &middot; {e.semester?.name}
                  </p>
                  {e.reason && <p className="text-xs text-slate-500 mt-1 italic">"{e.reason}"</p>}
                  <p className="text-xs text-slate-400 mt-0.5">Requested {formatDate(e.registeredAt)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                  {e.status === 'pending' && (
                    <>
                      <ActionButton icon={Check} label="Approve" cls="bg-green-600 text-white hover:bg-green-700" onClick={() => runAction(() => courseEnrollmentApi.approve(e._id), 'Enrollment approved')} />
                      <ActionButton icon={X} label="Reject" cls="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100" onClick={() => setRejecting(e._id)} />
                    </>
                  )}
                  {e.status === 'approved' && (
                    <>
                      <ActionButton icon={Play} label="Activate" cls="bg-sky-600 text-white hover:bg-sky-700" onClick={() => runAction(() => courseEnrollmentApi.activate(e._id), 'Enrollment activated')} />
                      <ActionButton icon={LogOut} label="Drop" cls="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100" onClick={() => runAction(() => courseEnrollmentApi.drop(e._id), 'Enrollment dropped')} />
                    </>
                  )}
                  {e.status === 'active' && (
                    <>
                      <ActionButton icon={CheckCircle2} label="Complete" cls="bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => runAction(() => courseEnrollmentApi.complete(e._id), 'Enrollment marked completed')} />
                      <ActionButton icon={LogOut} label="Drop" cls="bg-red-50 text-red-600 border border-red-200 hover:bg-red-100" onClick={() => runAction(() => courseEnrollmentApi.drop(e._id), 'Enrollment dropped')} />
                    </>
                  )}
                  <ActionButton icon={History} label="History" cls="border border-slate-300 text-slate-600 hover:bg-slate-50" onClick={() => setExpandedHistory(expandedHistory === e._id ? null : e._id)} />
                  {isSuperAdminTier && (
                    <ActionButton icon={Trash2} label="Delete" cls="border border-red-200 text-red-500 hover:bg-red-50" onClick={() => removeEnrollment(e._id)} />
                  )}
                </div>
              </div>

              {expandedHistory === e._id && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  {(e.history || []).length === 0 ? (
                    <p className="text-xs text-slate-400">No history recorded.</p>
                  ) : (
                    <ol className="space-y-1.5">
                      {[...e.history].reverse().map((h, i) => (
                        <li key={i} className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-slate-700">{h.action}</span>
                          <span>{h.previousStatus ? `${h.previousStatus} → ${h.newStatus}` : `→ ${h.newStatus}`}</span>
                          <span className="text-slate-400">{formatDate(h.timestamp)}</span>
                          {h.reason && <span className="italic">"{h.reason}"</span>}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {pagination.pages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-3 h-9 rounded-lg border border-slate-300 text-sm disabled:opacity-40">
            Prev
          </button>
          <span className="text-sm text-slate-500">
            Page {pagination.page} of {pagination.pages} &middot; {pagination.total} total
          </span>
          <button disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)} className="px-3 h-9 rounded-lg border border-slate-300 text-sm disabled:opacity-40">
            Next
          </button>
        </div>
      )}

      {rejecting && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setRejecting(null)}>
          <div className="bg-white rounded-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-slate-800 mb-3">Reject enrollment</h2>
            <form onSubmit={submitReject} className="space-y-3">
              <textarea
                required
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason for rejection (shown to the student)"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => setRejecting(null)} className="flex-1 h-10 rounded-lg border border-slate-300 text-sm text-slate-600">
                  Cancel
                </button>
                <button className="flex-1 h-10 rounded-lg bg-red-600 text-white text-sm font-semibold">Reject</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCreate && <CreateDirectModal courses={courses} semesters={semesters} onClose={() => setShowCreate(false)} onDone={invalidate} />}
      {showBulk && <BulkEnrollModal courses={courses} batches={batches} semesters={semesters} onClose={() => setShowBulk(false)} onDone={invalidate} />}
    </div>
  );
}

function ActionButton({ icon: Icon, label, cls, onClick }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium ${cls}`}>
      <Icon size={13} /> {label}
    </button>
  );
}

function CreateDirectModal({ courses, semesters, onClose, onDone }) {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [students, setStudents] = useState([]);
  const [studentId, setStudentId] = useState('');
  const [studentLabel, setStudentLabel] = useState('');
  const [courseId, setCourseId] = useState('');
  const [enrollmentType, setEnrollmentType] = useState('regular');
  const [semesterId, setSemesterId] = useState('');
  const [academicYear, setAcademicYear] = useState(String(new Date().getFullYear()));
  const [reason, setReason] = useState('');
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const findStudents = async () => {
    if (!search.trim()) return;
    setSearching(true);
    try {
      const res = await superAdminApi.listUsers({ role: 'student', q: search.trim(), limit: 10 });
      setStudents(res.data || []);
    } catch (err) {
      toast(err.response?.data?.message || 'Search failed', 'error');
    } finally {
      setSearching(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!studentId || !courseId || !semesterId) {
      toast('Select a student, course, and semester', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await courseEnrollmentApi.createDirect({ studentId, courseId, enrollmentType, academicYear, semesterId, reason });
      toast('Enrollment created', 'success');
      onDone();
      onClose();
    } catch (err) {
      toast(err.response?.data?.message || 'Create failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-800 mb-3">Create Enrollment Directly</h2>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-500">Student</label>
            {studentLabel ? (
              <div className="mt-1 flex items-center justify-between rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <span>{studentLabel}</span>
                <button
                  type="button"
                  onClick={() => {
                    setStudentId('');
                    setStudentLabel('');
                  }}
                  className="text-xs text-red-500"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <div className="flex gap-2 mt-1">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), findStudents())}
                    placeholder="Search by name, email, or roll no."
                    className="flex-1 h-9 rounded-lg border border-slate-300 px-3 text-sm"
                  />
                  <button type="button" onClick={findStudents} disabled={searching} className="h-9 px-3 rounded-lg border border-slate-300 text-sm">
                    {searching ? '...' : 'Find'}
                  </button>
                </div>
                {students.length > 0 && (
                  <div className="mt-1 border border-slate-200 rounded-lg max-h-40 overflow-y-auto">
                    {students.map((s) => (
                      <button
                        type="button"
                        key={s._id}
                        onClick={() => {
                          setStudentId(s._id);
                          setStudentLabel(`${s.name} (${s.email})`);
                          setStudents([]);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-100 last:border-0"
                      >
                        {s.name} <span className="text-xs text-slate-400">{s.email} {s.rollNo ? `· ${s.rollNo}` : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">Course</label>
            <select required value={courseId} onChange={(e) => setCourseId(e.target.value)} className="mt-1 w-full h-9 rounded-lg border border-slate-300 px-2 text-sm">
              <option value="">Select course</option>
              {courses.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.courseId} — {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">Enrollment type</label>
            <select value={enrollmentType} onChange={(e) => setEnrollmentType(e.target.value)} className="mt-1 w-full h-9 rounded-lg border border-slate-300 px-2 text-sm">
              <option value="regular">Regular</option>
              {STUDENT_REQUESTABLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500">Semester</label>
              <select required value={semesterId} onChange={(e) => setSemesterId(e.target.value)} className="mt-1 w-full h-9 rounded-lg border border-slate-300 px-2 text-sm">
                <option value="">Select</option>
                {semesters.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Academic year</label>
              <input required value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} className="mt-1 w-full h-9 rounded-lg border border-slate-300 px-2 text-sm" />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">Reason (optional)</label>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-lg border border-slate-300 text-sm text-slate-600">
              Cancel
            </button>
            <button disabled={submitting} className="flex-1 h-10 rounded-lg bg-brand-600 text-white text-sm font-semibold disabled:opacity-50">
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BulkEnrollModal({ courses, batches, semesters, onClose, onDone }) {
  const { toast } = useToast();
  const [courseId, setCourseId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [academicYear, setAcademicYear] = useState(String(new Date().getFullYear()));
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await courseEnrollmentApi.bulkEnrollRegular({ courseId, batchId, semesterId, academicYear });
      toast(res.message || 'Bulk enrollment complete', 'success');
      onDone();
      onClose();
    } catch (err) {
      toast(err.response?.data?.message || 'Bulk enroll failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-sm w-full p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-slate-800 mb-1">Bulk Enroll Batch (Regular)</h2>
        <p className="text-xs text-slate-500 mb-3">Creates a regular/active enrollment for every student in the batch, for one course.</p>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-500">Course</label>
            <select required value={courseId} onChange={(e) => setCourseId(e.target.value)} className="mt-1 w-full h-9 rounded-lg border border-slate-300 px-2 text-sm">
              <option value="">Select course</option>
              {courses.map((c) => (
                <option key={c._id} value={c._id}>
                  {c.courseId} — {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Batch</label>
            <select required value={batchId} onChange={(e) => setBatchId(e.target.value)} className="mt-1 w-full h-9 rounded-lg border border-slate-300 px-2 text-sm">
              <option value="">Select batch</option>
              {batches.map((b) => (
                <option key={b._id} value={b._id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500">Semester</label>
              <select required value={semesterId} onChange={(e) => setSemesterId(e.target.value)} className="mt-1 w-full h-9 rounded-lg border border-slate-300 px-2 text-sm">
                <option value="">Select</option>
                {semesters.map((s) => (
                  <option key={s._id} value={s._id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Academic year</label>
              <input required value={academicYear} onChange={(e) => setAcademicYear(e.target.value)} className="mt-1 w-full h-9 rounded-lg border border-slate-300 px-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-lg border border-slate-300 text-sm text-slate-600">
              Cancel
            </button>
            <button disabled={submitting} className="flex-1 h-10 rounded-lg bg-brand-600 text-white text-sm font-semibold disabled:opacity-50">
              {submitting ? 'Enrolling...' : 'Enroll Batch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
