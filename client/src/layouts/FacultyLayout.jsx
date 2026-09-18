import { LayoutDashboard, FileStack, ClipboardCheck, BookOpen, Upload, Megaphone, ClipboardList, BookMarked, GraduationCap, MessageCircle, Mail, Layers, Layers3, Users, HelpCircle, UserCheck, CalendarDays, CalendarClock } from 'lucide-react';
import DashboardShell from './DashboardShell.jsx';

const links = [
  { to: '/faculty', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/faculty/courses', label: 'My Courses', icon: BookOpen },
  // The timetable: the manager builds it for a batch, the calendar is the
  // faculty member's own view of it (their own classes only — see
  // academicEventService.audienceFilterFor).
  { to: '/faculty/routine', label: 'Routine Manager', icon: CalendarDays, flag: 'routineSystemEnabled' },
  { to: '/routine', label: 'My Calendar', icon: CalendarClock, flag: 'routineSystemEnabled' },
  { to: '/faculty/upload', label: 'Upload Material', icon: Upload },
  { to: '/faculty/reviews', label: 'Review Submissions', icon: ClipboardCheck },
  { to: '/faculty/student-id-approvals', label: 'Student ID Approvals', icon: UserCheck },
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
  { to: '/faculty/manual', label: 'User Manual', icon: HelpCircle },
];

export default function FacultyLayout() {
  return <DashboardShell title="Faculty Panel" links={links} />;
}
