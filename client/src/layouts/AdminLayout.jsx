import { LayoutDashboard, FileStack, Upload, UserCheck, ClipboardCheck, Megaphone, ClipboardList, BookMarked, GraduationCap, MessageCircle, Mail, Layers3, BookOpen, PenSquare, HelpCircle } from 'lucide-react';
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
  // Not a togglable admin-tier permission — every admin-tier role can act as
  // a student and request retake/extra/backlog/improvement/advance courses
  // for themselves, same as any Student account.
  { to: '/my-courses', label: 'My Courses', icon: BookOpen, flag: 'courseEnrollmentSystemEnabled' },
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
