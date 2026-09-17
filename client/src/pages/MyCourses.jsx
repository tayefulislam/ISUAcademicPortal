import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, X, BookOpen, RefreshCw, Users } from 'lucide-react';
import {
  authApi, courseApi, courseEnrollmentApi, departmentApi, profileApi, semesterApi,
} from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';

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

// The order the "other" enrolments are grouped in, so the page does not reshuffle
// itself between loads.
const OTHER_ORDER = ['retake', 'improvement', 'extra', 'backlog', 'advance'];

/**
 * A student's (or CR's) courses.
 *
 * Two sections, both from one API call: Running Courses are the student's own
 * department's courses for the semester they are currently in, and Other
 * Enrolled Courses are their active retake/improvement/… enrolments — rendered
 * only when they actually have one, never as an empty heading.
 *
 * Every course opens the same course page the faculty side uses; what that page
 * shows is decided by the server, not by this screen.
 */
export default function MyCourses() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showRequest, setShowRequest] = useState(false);

  const { data: settings } = useQuery({ queryKey: ['public-settings'], queryFn: authApi.publicSettings });
  // Reads the profile rather than the cached session user: department/batch/
  // semester come back populated there, and bare ObjectIds in the session copy.
  const { data: profile } = useQuery({ queryKey: ['profile'], queryFn: profileApi.get });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-courses-grouped'],
    queryFn: courseApi.mineGrouped,
  });

  const enrollmentSystemEnabled = !!settings?.data?.courseEnrollmentSystemEnabled;
  const allowedTypes = REQUESTABLE_TYPES.filter((t) => settings?.data?.[TYPE_FLAG[t]]);

  const me = profile?.data || user || {};
  const running = data?.data?.running || [];
  const other = data?.data?.other || [];

  const grouped = OTHER_ORDER.map((type) => ({
    type,
    rows: other.filter((row) => row.enrollmentType === type),
  })).filter((group) => group.rows.length);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['my-courses-grouped'] });
    qc.invalidateQueries({ queryKey: ['my-course-enrollments'] });
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-800">
            {me.name ? `Hello, ${me.name.split(' ')[0]}` : 'My Courses'}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {[
              me.department?.name,
              me.batch?.name ? `Batch ${me.batch.name}` : null,
              me.semester?.name,
            ].filter(Boolean).join(' · ') || 'Your courses for this semester.'}
          </p>
        </div>
        {enrollmentSystemEnabled && (
          <button
            onClick={() => setShowRequest(true)}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
          >
            <Plus size={16} /> Request Additional Course
          </button>
        )}
      </div>

      {isLoading ? (
        <CoursesSkeleton />
      ) : isError ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <p className="text-sm text-slate-600 mb-3">Unable to load courses.</p>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw size={14} /> Try Again
          </button>
        </div>
      ) : (
        <>
          <section className="mb-10">
            <div className="flex items-center gap-2 mb-1">
              <BookOpen size={18} className="text-brand-600" />
              <h2 className="text-lg font-semibold text-slate-800">Running Courses</h2>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              The courses your department is running this semester.
            </p>

            {running.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
                <p className="text-sm text-slate-500">No Running Courses</p>
                <p className="text-xs text-slate-400 mt-1">
                  You don&apos;t have any active courses for this semester yet.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {running.map((course) => (
                  <CourseCard key={course._id} course={course} />
                ))}
              </div>
            )}
          </section>

          {/* Only when the student actually has one — an empty "Retake" heading
              is noise, and the spec is explicit about hiding it. */}
          {grouped.map((group) => (
            <section key={group.type} className="mb-10">
              <div className="flex items-center gap-2 mb-1">
                <Users size={18} className="text-brand-600" />
                <h2 className="text-lg font-semibold text-slate-800">
                  {TYPE_LABELS[group.type]} Courses
                </h2>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Additional courses you are enrolled in for this type.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.rows.map((row) => (
                  <CourseCard
                    key={`${group.type}-${row.course._id}`}
                    course={row.course}
                    typeLabel={TYPE_LABELS[group.type]}
                    typeStyle={TYPE_STYLE[group.type]}
                    status={row.status}
                    academicYear={row.academicYear}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {showRequest && (
        <RequestModal
          allowedTypes={allowedTypes}
          onClose={() => setShowRequest(false)}
          onSubmitted={() => {
            setShowRequest(false);
            invalidate();
            toast('Request submitted — pending review', 'success');
          }}
        />
      )}
    </div>
  );
}

/** One course, as it appears on either list. */
function CourseCard({ course, typeLabel, typeStyle, status, academicYear }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3 hover:border-brand-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 truncate" title={course.name}>{course.name}</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {course.courseId}
            {course.department?.code ? ` · ${course.department.code}` : ''}
          </p>
        </div>
        {typeLabel && (
          <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${typeStyle}`}>
            {typeLabel}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        {course.semester && (
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{course.semester}</span>
        )}
        {academicYear && (
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">AY {academicYear}</span>
        )}
        {status && (
          <span className={`px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[status] || 'bg-slate-100 text-slate-600'}`}>
            {status}
          </span>
        )}
      </div>

      <Link
        to={`/courses/${course._id}`}
        className="mt-auto inline-flex items-center justify-center px-3 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        Open Course
      </Link>
    </div>
  );
}

function CoursesSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-5 w-44 bg-slate-100 rounded mb-4" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="h-4 w-3/5 bg-slate-100 rounded mb-2.5" />
            <div className="h-3 w-2/5 bg-slate-100 rounded mb-4" />
            <div className="h-9 w-full bg-slate-100 rounded-lg" />
          </div>
        ))}
      </div>
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
