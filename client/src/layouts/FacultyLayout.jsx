import { LayoutDashboard, FileStack, ClipboardCheck, BookOpen, Upload, Megaphone, ClipboardList, BookMarked, GraduationCap, MessageCircle, Mail, Layers, Layers3, Users } from 'lucide-react';
import DashboardShell from './DashboardShell.jsx';

const links = [
  { to: '/faculty', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/faculty/courses', label: 'My Courses', icon: BookOpen },
  { to: '/faculty/upload', label: 'Upload Material', icon: Upload },
  { to: '/faculty/reviews', label: 'Review Submissions', icon: ClipboardCheck },
  { to: '/faculty/files', label: 'Assigned Materials', icon: FileStack },
  { to: '/faculty/chapters-topics', label: 'Chapters & Topics', icon: Layers, flag: 'facultyChapterTopicEnabled' },
  { to: '/faculty/notices', label: 'Notices', icon: Megaphone },
  { to: '/faculty/assignments', label: 'Assignments', icon: ClipboardList },
  { to: '/faculty/question-bank', label: 'Question Bank', icon: BookMarked },
  { to: '/faculty/quizzes', label: 'Quizzes', icon: GraduationCap },
  { to: '/faculty/messages', label: 'Messages', icon: MessageCircle, flag: 'messagingSystemEnabled' },
  { to: '/faculty/emails', label: 'Email Center', icon: Mail, flag: 'emailSystemEnabled' },
  { to: '/faculty/enrollments', label: 'Course Enrollment', icon: Layers3, flag: 'courseEnrollmentSystemEnabled' },
  { to: '/faculty/enrollments/roster', label: 'Enrolled Students', icon: Users, flag: 'courseEnrollmentSystemEnabled' },
];

export default function FacultyLayout() {
  return <DashboardShell title="Faculty Panel" links={links} />;
}
