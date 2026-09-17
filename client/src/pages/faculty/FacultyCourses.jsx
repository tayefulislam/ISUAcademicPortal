import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Power, RefreshCw, Upload } from 'lucide-react';
import { facultyApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

/**
 * A faculty member's courses, split by whether they are currently teaching them.
 *
 * The status is per-faculty (see the server's FacultyCourse model): deactivating
 * a course here takes it out of *this* faculty member's Active Classes and
 * affects nobody else — it never hides the course from students, other faculty,
 * or its own content. Deactivating is therefore not a delete.
 */
export default function FacultyCourses() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['faculty-courses', 'with-status'],
    queryFn: () => facultyApi.courseList({ counts: true }),
  });

  const courses = data?.data || [];
  const active = courses.filter((c) => c.teachingStatus === 'active');
  const deactivated = courses.filter((c) => c.teachingStatus !== 'active');

  const setStatus = async (course, status) => {
    setBusyId(course._id);
    try {
      const res = await facultyApi.setCourseStatus(course._id, status);
      toast(res.message || 'Course updated', 'success');
      qc.invalidateQueries({ queryKey: ['faculty-courses'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Could not update the course', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">My Courses</h1>
          <p className="text-sm text-slate-500 mt-1">
            Activate a class to make it appear under Active Classes.
          </p>
        </div>
        <Link
          to="/faculty/upload"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-50"
        >
          <Upload size={18} /> Upload Material
        </Link>
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
      ) : courses.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <p className="text-sm text-slate-600">No courses assigned to you yet.</p>
          <p className="text-xs text-slate-400 mt-1">
            Ask a Super Admin to assign you a Department or Course.
          </p>
        </div>
      ) : (
        <>
          <Section
            title="Active Classes"
            emptyTitle="No Active Classes"
            emptyText="Activate a course to make it appear here."
            courses={active}
            busyId={busyId}
            onSetStatus={setStatus}
          />
          <Section
            title="Deactivated Classes"
            emptyTitle="Nothing deactivated"
            emptyText="Courses you are not currently teaching appear here."
            courses={deactivated}
            busyId={busyId}
            onSetStatus={setStatus}
          />
        </>
      )}
    </div>
  );
}

function Section({ title, emptyTitle, emptyText, courses, busyId, onSetStatus }) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 mb-4">
        <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium">
          {courses.length}
        </span>
      </div>

      {courses.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-xl p-6 text-center">
          <p className="text-sm text-slate-500">{emptyTitle}</p>
          <p className="text-xs text-slate-400 mt-1">{emptyText}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map((course) => (
            <CourseCard
              key={course._id}
              course={course}
              busy={busyId === course._id}
              onSetStatus={onSetStatus}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CourseCard({ course, busy, onSetStatus }) {
  const isActive = course.teachingStatus === 'active';
  const counts = course.counts || { files: 0, assignments: 0, quizzes: 0 };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3 hover:border-brand-300 hover:shadow-sm transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="shrink-0 w-9 h-9 rounded-lg bg-brand-50 text-brand-700 grid place-items-center">
            <BookOpen size={17} />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 truncate" title={course.name}>{course.name}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {course.courseId}
              {course.department?.code ? ` · ${course.department.code}` : ''}
            </p>
          </div>
        </div>
        <StatusPill active={isActive} />
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        {course.semester && (
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{course.semester}</span>
        )}
      </div>

      <p className="text-xs text-slate-400">
        {counts.files} files · {counts.assignments} assignments · {counts.quizzes} quizzes
      </p>

      <div className="flex items-center gap-2 mt-auto">
        <Link
          to={`/courses/${course._id}`}
          className="flex-1 inline-flex items-center justify-center px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
        >
          Open Course
        </Link>
        {isActive ? (
          <button
            onClick={() => onSetStatus(course, 'deactivated')}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Power size={14} /> Deactivate
          </button>
        ) : (
          <button
            onClick={() => onSetStatus(course, 'active')}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Power size={14} /> Activate
          </button>
        )}
      </div>
    </div>
  );
}

/** 🟢 Active / ⚪ Deactivated — a shape plus a word, never colour alone. */
function StatusPill({ active }) {
  const cls = active
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-slate-50 text-slate-500 border-slate-200';
  return (
    <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {active ? 'Active' : 'Deactivated'}
    </span>
  );
}

function CoursesSkeleton() {
  return (
    <div className="animate-pulse">
      {[0, 1].map((section) => (
        <div key={section} className="mb-10">
          <div className="h-5 w-40 bg-slate-100 rounded mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="h-4 w-3/5 bg-slate-100 rounded mb-2.5" />
                <div className="h-3 w-2/5 bg-slate-100 rounded mb-4" />
                <div className="h-9 w-full bg-slate-100 rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
