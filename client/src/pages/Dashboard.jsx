import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Sparkles, Clock, Bookmark, FileClock, Megaphone, ClipboardList, FileQuestion, UploadCloud, MessageCircle, User, LogOut, Layers3, CalendarClock, CalendarDays, FileText } from 'lucide-react';
import FileCard from '../components/FileCard.jsx';
import FileGridSkeleton from '../components/FileGridSkeleton.jsx';
import SmartEventWidget from '../components/routine/SmartEventWidget.jsx';
import { eventIcon, eventTitle, typeLabel, timeRange, locationLine } from '../components/routine/eventMeta.js';
import { fileApi, noticeApi, assignmentApi, authApi, routineApi, calendarApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useDownloadFile } from '../hooks/useDownloadFile.js';
import { formatDate } from '../utils/format.js';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const download = useDownloadFile();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => fileApi.dashboard(8) });
  const { data: mine, isLoading: loadingMine } = useQuery({
    queryKey: ['my-submissions'],
    queryFn: () => fileApi.mine({ limit: 5 }),
    enabled: user?.role === 'student',
  });
  const { data: noticesData, isLoading: loadingNotices } = useQuery({ queryKey: ['notices'], queryFn: noticeApi.list });
  const { data: assignmentsData, isLoading: loadingAssignments, isError: assignmentsDisabled } = useQuery({
    queryKey: ['assignments'],
    queryFn: assignmentApi.list,
    retry: false,
  });
  const { data: settings } = useQuery({ queryKey: ['public-settings'], queryFn: authApi.publicSettings, staleTime: 60_000 });
  const messagingEnabled = settings?.data?.messagingSystemEnabled !== false;
  const documentsEnabled = settings?.data?.documentGeneratorEnabled !== false;
  const applicationWriterEnabled = settings?.data?.applicationWriterEnabled !== false;
  // The routine system is opt-in, so this must be an explicit `=== true` rather
  // than the "absent means on" rule the other flags use.
  const routineEnabled = settings?.data?.routineSystemEnabled === true;
  const { data: todayData, isLoading: loadingToday } = useQuery({
    queryKey: ['routine', 'today'],
    queryFn: routineApi.today,
    enabled: routineEnabled,
  });
  const { data: examsData } = useQuery({
    queryKey: ['routine', 'my-exams'],
    queryFn: calendarApi.myExams,
    enabled: routineEnabled,
  });
  const todayEvents = todayData?.data || [];
  const upcomingExams = (examsData?.data || []).slice(0, 3);
  // `nextStep` is computed server-side (registrationFlowService.js's
  // getNextRequiredStep — the single source of truth for this decision) and
  // attached to the cached user object by every auth response (login,
  // register, verify-otp, /auth/me), so it's already available with no
  // extra request — unlike the settings query above (kept only for
  // messagingEnabled), nothing here needs to wait on a load. Mirrors the
  // server's own isBlockedByApproval() gate (courseAccessService.js) — a
  // pending/rejected student is redirected away from the Dashboard entirely
  // (spec: they must not see Dashboard, My Courses, Assignments, Quizzes,
  // Messages, Submit Material, or other protected academic content — only
  // Profile/Logout). The server-side gate is the real enforcement; this
  // redirect is purely the matching UX so they land somewhere that explains
  // why, instead of a broken-looking empty Dashboard.
  const isPendingApproval = user?.nextStep === 'STUDENT_ID_SUBMISSION' || user?.nextStep === 'WAITING_FOR_APPROVAL';

  const recommended = data?.data?.recommended || [];
  const recent = data?.data?.recent || [];
  const bookmarked = data?.data?.bookmarked || [];
  const submissions = mine?.data || [];
  const notices = (noticesData?.data || []).slice(0, 3);
  const pendingAssignments = (assignmentsData?.data || []).filter((a) => a.status === 'published' && (!a.mySubmission || a.mySubmission.status !== 'graded')).slice(0, 3);

  if (isPendingApproval) {
    return <Navigate to="/pending-approval" replace />;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Welcome back, {user?.name?.split(' ')[0]}</h1>
      <p className="text-sm text-slate-500 mb-4">Materials picked for your department, batch, and semester.</p>

      <div className="flex flex-wrap gap-2 mb-8">
        <QuickLink to="/profile" icon={User} label="Profile" />
        {documentsEnabled && <QuickLink to="/documents" icon={FileText} label="Documents" />}
        {applicationWriterEnabled && <QuickLink to="/write-application" icon={FileText} label="Write Application" />}
        {applicationWriterEnabled && <QuickLink to="/my-applications" icon={FileText} label="My Applications" />}
        <QuickLink to="/my-bookmarks" icon={Bookmark} label="Bookmarks" />
        {routineEnabled && <QuickLink to="/routine" icon={CalendarClock} label="Calendar" />}
        {user?.role === 'student' && <QuickLink to="/my-courses" icon={Layers3} label="My Courses" />}
        <QuickLink to="/assignments" icon={ClipboardList} label="Assignments" />
        <QuickLink to="/quizzes" icon={FileQuestion} label="Quizzes" />
        {user?.role === 'student' && <QuickLink to="/submit-material" icon={UploadCloud} label="Submit Material" />}
        {messagingEnabled && <QuickLink to="/messages" icon={MessageCircle} label="Messages" />}
        <button
          onClick={() => {
            logout();
            navigate('/');
          }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white border border-slate-200 text-slate-600 hover:bg-red-50 hover:text-red-600"
        >
          <LogOut size={15} /> Logout
        </button>
      </div>

      {/* Today first: what is on now, what is next, then the rest of the day
          and the next exams (spec §35). Opt-in behind routineSystemEnabled. */}
      {routineEnabled && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <CalendarClock className="text-brand-600" size={20} />
              <h2 className="text-xl font-bold text-slate-800">Today</h2>
            </div>
            <Link to="/routine" className="text-sm text-brand-600 hover:underline">Open calendar</Link>
          </div>

          <SmartEventWidget mode="dashboard" className="mb-4" />

          {loadingToday ? (
            <div className="h-16 rounded-xl bg-slate-100 animate-pulse" />
          ) : todayEvents.length > 0 && (
            <div className="space-y-2">
              {todayEvents.map((e) => {
                const Icon = eventIcon(e);
                const cancelled = e.status === 'CANCELLED';
                return (
                  <div
                    key={e.id}
                    className={`bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3 ${cancelled ? 'opacity-60' : ''}`}
                  >
                    <span className="shrink-0 w-9 h-9 rounded-lg bg-slate-50 grid place-items-center">
                      <Icon size={16} className="text-slate-400" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-700 truncate">{eventTitle(e)}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {timeRange(e)} &middot; {locationLine(e)} &middot; {typeLabel(e)}
                      </p>
                    </div>
                    {cancelled && (
                      <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-600">Cancelled</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {routineEnabled && upcomingExams.length > 0 && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <CalendarDays className="text-brand-600" size={20} />
            <h2 className="text-xl font-bold text-slate-800">Upcoming exams</h2>
          </div>
          <div className="space-y-2">
            {upcomingExams.map((e) => (
              <div key={e.id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-700 truncate">{e.title || eventTitle(e)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {typeLabel(e)} &middot; {timeRange(e)} &middot; {locationLine(e)}
                  </p>
                </div>
                <span className="shrink-0 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700">
                  {formatDate(`${e.date}T00:00:00+06:00`)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Megaphone className="text-brand-600" size={20} />
            <h2 className="text-xl font-bold text-slate-800">Notices</h2>
          </div>
          <Link to="/notices" className="text-sm text-brand-600 hover:underline">View all</Link>
        </div>
        {loadingNotices ? (
          <p className="text-slate-400">Loading...</p>
        ) : notices.length === 0 ? (
          <p className="text-slate-400">No notices right now.</p>
        ) : (
          <div className="space-y-2">
            {notices.map((n) => (
              <div key={n._id} className="bg-white border border-slate-200 rounded-xl p-4">
                <p className="font-medium text-slate-700">{n.title}</p>
                <p className="text-sm text-slate-500 mt-0.5 line-clamp-2">{n.description}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {!assignmentsDisabled && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ClipboardList className="text-brand-600" size={20} />
              <h2 className="text-xl font-bold text-slate-800">Assignments</h2>
            </div>
            <Link to="/assignments" className="text-sm text-brand-600 hover:underline">View all</Link>
          </div>
          {loadingAssignments ? (
            <p className="text-slate-400">Loading...</p>
          ) : pendingAssignments.length === 0 ? (
            <p className="text-slate-400">Nothing pending — you're all caught up.</p>
          ) : (
            <div className="space-y-2">
              {pendingAssignments.map((a) => (
                <div key={a._id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-700 truncate">{a.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">Deadline {formatDate(a.deadline)}</p>
                  </div>
                  <span
                    className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${
                      a.mySubmission ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {a.mySubmission ? a.mySubmission.status : 'Not submitted'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {user?.role === 'student' && (
        <section className="mb-10">
          <div className="flex items-center gap-2 mb-4">
            <FileClock className="text-brand-600" size={20} />
            <h2 className="text-xl font-bold text-slate-800">My Submissions</h2>
          </div>
          {loadingMine ? (
            <p className="text-slate-400">Loading...</p>
          ) : submissions.length === 0 ? (
            <p className="text-slate-400">
              You haven't submitted any materials yet.{' '}
              <Link to="/submit-material" className="text-brand-600 hover:underline">
                Submit one
              </Link>
              .
            </p>
          ) : (
            <div className="space-y-2">
              {submissions.map((f) => (
                <div key={f._id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-700 truncate">{f.title}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {f.departmentCode} &middot; {f.courseId} &middot; {formatDate(f.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${
                      f.approvalStatus === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    {f.approvalStatus === 'pending' ? 'Pending review' : 'Approved'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <Section title="Recommended for you" icon={Sparkles} loading={isLoading} files={recommended} download={download} empty="No recommended materials yet." />
      <Section title="Recently added" icon={Clock} loading={isLoading} files={recent} download={download} empty="Nothing recent yet." />
      <Section title="Your bookmarks" icon={Bookmark} loading={isLoading} files={bookmarked} download={download} empty="You haven't bookmarked anything yet." />
    </div>
  );
}

function QuickLink({ to, icon: Icon, label }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-white border border-slate-200 text-slate-600 hover:bg-brand-50 hover:text-brand-700"
    >
      <Icon size={15} /> {label}
    </Link>
  );
}

function Section({ title, icon: Icon, loading, files, download, empty }) {
  return (
    <section className="mb-10">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="text-brand-600" size={20} />
        <h2 className="text-xl font-bold text-slate-800">{title}</h2>
      </div>
      {loading ? (
        <FileGridSkeleton count={3} />
      ) : files.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {files.map((f) => (
            <FileCard key={f._id} file={f} onDownload={download} />
          ))}
        </div>
      ) : (
        <p className="text-slate-400">{empty}</p>
      )}
    </section>
  );
}
