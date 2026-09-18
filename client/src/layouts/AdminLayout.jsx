import { LayoutDashboard, FileStack, Upload, UserCheck, ClipboardCheck, Megaphone, ClipboardList, BookMarked, GraduationCap, MessageCircle, Mail, Layers3, BookOpen, PenSquare, HelpCircle, UploadCloud, Bookmark, CalendarDays, CalendarClock } from 'lucide-react';
import DashboardShell from './DashboardShell.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const links = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/files', label: 'My Files', icon: FileStack, permission: 'files' },
  { to: '/admin/upload', label: 'Upload File', icon: Upload, permission: 'files' },
  { to: '/admin/approvals', label: 'Student Approvals', icon: UserCheck, permission: 'approvals' },
  { to: '/admin/reviews', label: 'Material Submissions', icon: ClipboardCheck, permission: 'reviews' },
  { to: '/admin/notices', label: 'Notices', icon: Megaphone, permission: 'notices' },
  { to: '/admin/assignments', label: 'Assignments', icon: ClipboardList, permission: 'assignments' },
  { to: '/admin/question-bank', label: 'Question Bank', icon: BookMarked, permission: 'question_bank' },
  { to: '/admin/quizzes', label: 'Quizzes', icon: GraduationCap, permission: 'quizzes' },
  { to: '/admin/messages', label: 'Messages', icon: MessageCircle, flag: 'messagingSystemEnabled', permission: 'messages' },
  { to: '/admin/emails', label: 'Email Center', icon: Mail, flag: 'emailSystemEnabled', permission: 'emails' },
  { to: '/admin/enrollments', label: 'Course Enrollment', icon: Layers3, flag: 'courseEnrollmentSystemEnabled', permission: 'enrollments' },
  // Gated by the routine_create permission rather than the usual per-module
  // permission, so a CR can be given "build the timetable" without also being
  // handed the rest of the file/admin modules.
  { to: '/admin/routine', label: 'Routine Manager', icon: CalendarDays, flag: 'routineSystemEnabled', permission: 'routine_create' },
  { to: '/routine', label: 'My Calendar', icon: CalendarClock, flag: 'routineSystemEnabled' },
  // "Act as a student" links — every admin-tier role (e.g. "CR") gets these
  // unconditionally, the same way a Student account would, since none of
  // them are gated by a togglable admin-tier permission. Ownership/ID-based
  // checks in each underlying endpoint (not role) are what actually scope
  // what's returned, so this is safe for every admin-tier role uniformly,
  // 'admin' included.
  { to: '/my-bookmarks', label: 'Bookmarks', icon: Bookmark },
  { to: '/my-courses', label: 'My Courses', icon: BookOpen, flag: 'courseEnrollmentSystemEnabled' },
  // Distinct from the "Assignments" management link above (permission:
  // 'assignments', -> /admin/assignments) — this is the student-facing
  // view/submit page. A CR typically has no 'assignments' management
  // permission at all, so without this link they'd have no way to reach
  // Assignments in the nav despite submitAssignment already letting any
  // admin-tier role submit (isAdminTierRole bypass in assignmentController.js).
  // `hideIfPermission: 'assignments'` avoids showing two identically-labeled
  // "Assignments" links to whoever (e.g. 'admin') already has the
  // management one.
  { to: '/assignments', label: 'Assignments', icon: ClipboardList, flag: 'assignmentSystemEnabled', hideIfPermission: 'assignments' },
  // Same "act as a student" precedent as My Courses above, but scoped to a
  // custom admin-tier role (e.g. "CR") only — the unrestricted 'admin' role
  // already has its own unrestricted equivalent (Upload File, above) and
  // typically has no department/batch of its own to scope a submission by.
  // `hideIfPermission: 'files'` (rather than a hardcoded role) is what
  // actually excludes 'admin' here — 'admin' has every permission including
  // 'files', so this resolves to the same outcome as before but stays
  // correct for any OTHER role that later gets the 'files' permission too
  // (no reason to show both Submit Material and Upload Files to the same
  // account).
  { to: '/submit-material', label: 'Submit Material', icon: UploadCloud, flag: 'studentUploadEnabled', hideIfPermission: 'files' },
  // Same "act as a student" precedent as My Courses above — the backend
  // already lets any admin-tier role (e.g. CR) take a quiz/exam and see its
  // own graded result via the identical code path a Student uses (ownership
  // is checked by `attempt.student`, never by role); this was previously
  // only reachable by typing the /quizzes URL directly.
  { to: '/quizzes', label: 'My Exams', icon: PenSquare, flag: 'quizSystemEnabled' },
  { to: '/admin/manual', label: 'User Manual', icon: HelpCircle },
];

// Shared by Admin and any further admin-tier role Super Admin creates (e.g.
// "CR") — the sidebar itself is identical; DashboardShell filters each
// link's visibility by that role's actual granted permissions.
export default function AdminLayout() {
  const { user, isSuperAdmin } = useAuth();
  const title = isSuperAdmin || user?.role === 'admin' ? 'Admin Panel' : `${user?.role?.toUpperCase() || 'Admin'} Panel`;
  return <DashboardShell title={title} links={links} />;
}
