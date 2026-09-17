import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, BookOpen, ClipboardList, FileText, ListChecks, Plus, Power,
} from 'lucide-react';
import { assignmentApi, courseApi, facultyApi, fileApi, quizApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useDownloadFile } from '../hooks/useDownloadFile.js';
import { useToast } from '../context/ToastContext.jsx';
import FileCard from '../components/FileCard.jsx';
import FileGridSkeleton from '../components/FileGridSkeleton.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { formatDate } from '../utils/format.js';

const TABS = [
  { key: 'files', label: 'Files', icon: FileText },
  { key: 'assignments', label: 'Assignments', icon: ClipboardList },
  { key: 'quizzes', label: 'Quizzes', icon: ListChecks },
];

const PAGE_LIMIT = 50;

/**
 * One course, opened from My Courses.
 *
 * Faculty get a batch selector (the most recent batches, with their content
 * counts) and can add material to the selected batch. Students see their own
 * batch's content only — and that scoping is the server's, not this screen's:
 * every list below is fetched through the audience endpoints, so passing a
 * different course or batch can only ever return less.
 */
export default function CoursePage() {
  const { courseId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isFaculty, isAdmin, hasPermission } = useAuth();
  const { toast } = useToast();
  const download = useDownloadFile();

  const [tab, setTab] = useState('files');
  const [busy, setBusy] = useState(false);

  const batch = searchParams.get('batch') || '';

  const { data: courseData, isLoading: courseLoading } = useQuery({
    queryKey: ['course', courseId],
    queryFn: () => courseApi.get(courseId),
  });
  const course = courseData?.data;

  // Who can author content on this page: faculty (their own courses) and any
  // admin-tier role holding the matching permission module. 'students' — the
  // `courses` permission, not a role check.
  const isStaff = isFaculty || isAdmin;
  const canAddFiles = isFaculty || hasPermission('files');
  const canAddAssignments = isFaculty || hasPermission('assignments');
  const canAddQuizzes = isFaculty || hasPermission('quizzes');

  const { data: batchData } = useQuery({
    queryKey: ['course-batches', courseId],
    queryFn: () => courseApi.batches(courseId),
    enabled: !!courseId && isStaff,
  });
  const batches = batchData?.data || [];

  // This faculty member's own state for the course (active classes vs
  // deactivated). It is per-faculty, which is why it comes from the faculty
  // list rather than from the course record.
  const { data: teachingData } = useQuery({
    queryKey: ['faculty-courses', 'teaching'],
    queryFn: () => facultyApi.courseList({}),
    enabled: !!courseId && isFaculty,
  });
  const teaching = (teachingData?.data || []).find((c) => c._id === courseId);
  const teachingStatus = teaching?.teachingStatus || 'deactivated';

  // Default the faculty view to the most recent batch so the page is never
  // empty-by-default; the student view leaves it unset (the server scopes to
  // their own batch regardless).
  useEffect(() => {
    if (!isStaff || batch || !batches.length) return;
    setSearchParams({ batch: batches[0]._id }, { replace: true });
  }, [isStaff, batch, batches, setSearchParams]);

  const scope = useMemo(
    () => ({ course: courseId, batch: batch || undefined, limit: PAGE_LIMIT }),
    [courseId, batch]
  );

  const { data: filesData, isFetching: filesLoading } = useQuery({
    queryKey: ['course-files', courseId, batch, isStaff],
    queryFn: () => (isStaff ? facultyApi.files(scope) : fileApi.list(scope)),
    enabled: !!courseId && tab === 'files',
  });

  const { data: assignmentsData, isFetching: assignmentsLoading } = useQuery({
    queryKey: ['course-assignments', courseId, batch, isStaff],
    queryFn: () =>
      isStaff ? assignmentApi.mineInCourse(scope) : assignmentApi.listInCourse(scope),
    enabled: !!courseId && tab === 'assignments',
  });

  const { data: quizzesData, isFetching: quizzesLoading } = useQuery({
    queryKey: ['course-quizzes', courseId, batch, isStaff],
    queryFn: () => (isStaff ? quizApi.mineInCourse(scope) : quizApi.listInCourse(scope)),
    enabled: !!courseId && tab === 'quizzes',
  });

  const setStatus = async (status) => {
    setBusy(true);
    try {
      const res = await facultyApi.setCourseStatus(courseId, status);
      toast(res.message || 'Course updated', 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Could not update the course', 'error');
    } finally {
      setBusy(false);
    }
  };

  const addContentLinks = useMemo(() => {
    const prefix = isFaculty ? '/faculty' : '/admin';
    const qs = new URLSearchParams({ course: courseId });
    if (batch) qs.set('batch', batch);
    const suffix = `?${qs.toString()}`;
    return {
      file: `${prefix}/upload${suffix}`,
      assignment: `${prefix}/assignments${suffix}`,
      quiz: `${prefix}/quizzes${suffix}`,
    };
  }, [isFaculty, courseId, batch]);

  const loading = courseLoading;
  const activeBatch = batches.find((b) => b._id === batch);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <Link
        to={isStaff ? '/faculty/courses' : '/my-courses'}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4"
      >
        <ArrowLeft size={15} /> My Courses
      </Link>

      {loading ? (
        <SkeletonHeader />
      ) : !course ? (
        <EmptyState title="Course not found" description="It may have been removed." />
      ) : (
        <>
          {/* Course header */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 mb-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-start gap-3 min-w-0">
                <span className="shrink-0 w-11 h-11 rounded-xl bg-brand-50 text-brand-700 grid place-items-center">
                  <BookOpen size={20} />
                </span>
                <div className="min-w-0">
                  <h1 className="text-xl sm:text-2xl font-bold text-slate-800 truncate">{course.name}</h1>
                  <p className="text-sm text-slate-500 mt-0.5">
                    {course.courseId}
                    {course.department?.code ? ` · ${course.department.code}` : ''}
                    {course.semester ? ` · ${course.semester}` : ''}
                  </p>
                  {/* The student's own position in the course, from their profile. */}
                  {user && !isStaff && (
                    <p className="text-xs text-slate-400 mt-1">
                      {user.batch?.name ? `Batch ${user.batch.name} · ` : ''}
                      {user.semester?.name || ''}
                    </p>
                  )}
                </div>
              </div>

              {isFaculty && (
                <div className="flex items-center gap-2">
                  <StatusPill active={teachingStatus === 'active'} />
                  <button
                    onClick={() => setStatus('active')}
                    disabled={busy || teachingStatus === 'active'}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Power size={14} /> Activate
                  </button>
                  <button
                    onClick={() => setStatus('deactivated')}
                    disabled={busy || teachingStatus !== 'active'}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Deactivate
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Batch selector — staff only. A student's batch is fixed by their
              profile, and the server scopes their content to it either way. */}
          {isStaff && (
            <div className="mb-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Batch</p>
              <div className="flex flex-wrap gap-2">
                {batches.map((b) => (
                  <button
                    key={b._id}
                    onClick={() => setSearchParams({ batch: b._id }, { replace: true })}
                    className={`px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                      b._id === batch
                        ? 'border-brand-600 bg-brand-50 text-brand-700 font-semibold'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300'
                    }`}
                  >
                    <span className="block">{b.name}</span>
                    <span className="block text-[11px] text-slate-400">
                      {b.counts.files} files · {b.counts.assignments} assignments · {b.counts.quizzes} quizzes
                    </span>
                  </button>
                ))}
                {!batches.length && (
                  <span className="text-sm text-slate-400">No batches are configured yet.</span>
                )}
              </div>
            </div>
          )}

          {/* Tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 mb-4">
            <div className="flex gap-1">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 -mb-px border-b-2 text-sm font-medium transition-colors ${
                      tab === t.key
                        ? 'border-brand-600 text-brand-700'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    <Icon size={15} /> {t.label}
                  </button>
                );
              })}
            </div>

            {isStaff && (
              <div className="flex flex-wrap gap-2 pb-2">
                {canAddFiles && (
                  <AddLink to={addContentLinks.file} label="Add file" />
                )}
                {canAddAssignments && (
                  <AddLink to={addContentLinks.assignment} label="Add assignment" />
                )}
                {canAddQuizzes && (
                  <AddLink to={addContentLinks.quiz} label="Add quiz" />
                )}
              </div>
            )}
          </div>

          {tab === 'files' && (
            <FilesTab
              files={filesData?.data || []}
              loading={filesLoading}
              download={download}
            />
          )}

          {tab === 'assignments' && (
            <AssignmentsTab
              assignments={assignmentsData?.data || []}
              loading={assignmentsLoading}
            />
          )}

          {tab === 'quizzes' && (
            <QuizzesTab quizzes={quizzesData?.data || []} loading={quizzesLoading} />
          )}

          {isStaff && activeBatch && (
            <p className="text-xs text-slate-400 mt-6">
              Everything you add here is attached to {course.name}
              {activeBatch ? ` · ${activeBatch.name}` : ''} — the course and department are already filled in.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function AddLink({ to, label }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
    >
      <Plus size={14} /> {label}
    </Link>
  );
}

/** 🟢 Active / ⚪ Deactivated, drawn rather than emoji (no emoji in the UI). */
function StatusPill({ active }) {
  const cls = active
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : 'bg-slate-50 text-slate-500 border-slate-200';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      {active ? 'Active' : 'Deactivated'}
    </span>
  );
}

function FilesTab({ files, loading, download }) {
  if (loading) return <FileGridSkeleton />;
  if (!files.length) {
    return (
      <EmptyState
        title="No files yet"
        description="No files have been added to this course yet."
      />
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {files.map((file) => (
        <FileCard key={file._id} file={file} onDownload={download} />
      ))}
    </div>
  );
}

function AssignmentsTab({ assignments, loading }) {
  if (loading) return <ListSkeleton />;
  if (!assignments.length) {
    return <EmptyState title="No assignments" description="No assignments have been created yet." />;
  }
  return (
    <ul className="space-y-3">
      {assignments.map((a) => (
        <li key={a._id} className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-slate-800">{a.title}</p>
              {a.description && <p className="text-sm text-slate-500 mt-0.5 line-clamp-2">{a.description}</p>}
              <p className="text-xs text-slate-400 mt-1.5">
                Due {formatDate(a.deadline)} · {a.maxMarks} marks
                {a.mySubmission ? ` · Submitted (${a.mySubmission.status})` : ''}
              </p>
            </div>
            <span className="shrink-0 px-2.5 py-1 rounded-full border text-xs font-medium bg-slate-50 text-slate-600 border-slate-200">
              {a.status}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function QuizzesTab({ quizzes, loading }) {
  if (loading) return <ListSkeleton />;
  if (!quizzes.length) {
    return <EmptyState title="No quizzes" description="No quizzes are available yet." />;
  }
  return (
    <ul className="space-y-3">
      {quizzes.map((q) => (
        <li key={q._id} className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-slate-800">{q.title}</p>
              <p className="text-xs text-slate-400 mt-1.5">
                {q.totalMarks ? `${q.totalMarks} marks · ` : ''}
                Opens {formatDate(q.startAt)} · Closes {formatDate(q.endAt)}
              </p>
            </div>
            <span className="shrink-0 px-2.5 py-1 rounded-full border text-xs font-medium bg-slate-50 text-slate-600 border-slate-200">
              {q.status}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Skeleton placeholders — never a blank screen while loading. */
function SkeletonHeader() {
  return (
    <div className="animate-pulse">
      <div className="bg-white border border-slate-200 rounded-xl p-6 mb-5">
        <div className="h-5 w-52 bg-slate-100 rounded mb-3" />
        <div className="h-3.5 w-36 bg-slate-100 rounded" />
      </div>
      <div className="flex gap-2 mb-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-10 w-28 bg-slate-100 rounded-lg" />
        ))}
      </div>
      <ListSkeleton />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="h-4 w-2/5 bg-slate-100 rounded mb-2.5" />
          <div className="h-3 w-3/5 bg-slate-100 rounded" />
        </div>
      ))}
    </div>
  );
}
