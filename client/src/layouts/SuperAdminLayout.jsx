import { LayoutDashboard, Users2, UserCheck, FileStack, Settings, GraduationCap, MessageSquareText, MessageCircle, Mail, Layers3, Bell, HelpCircle, AlertTriangle, CalendarDays, CalendarClock, FileText } from 'lucide-react';
import DashboardShell from './DashboardShell.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const links = [
  { to: '/super-admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/super-admin/users', label: 'All Users', icon: Users2 },
  { to: '/super-admin/approvals', label: 'Student Approvals', icon: UserCheck },
  { to: '/super-admin/faculty', label: 'Faculty', icon: GraduationCap },
  { to: '/super-admin/files', label: 'All Files', icon: FileStack },
  { to: '/super-admin/feedback', label: 'Feedback', icon: MessageSquareText },
  { to: '/super-admin/messages', label: 'Messages', icon: MessageCircle, flag: 'messagingSystemEnabled' },
  { to: '/super-admin/emails', label: 'Email Center', icon: Mail, flag: 'emailSystemEnabled' },
  { to: '/super-admin/enrollments', label: 'Course Enrollment', icon: Layers3, flag: 'courseEnrollmentSystemEnabled' },
  { to: '/super-admin/routine', label: 'Routine Manager', icon: CalendarDays, flag: 'routineSystemEnabled' },
  { to: '/routine', label: 'My Calendar', icon: CalendarClock, flag: 'routineSystemEnabled' },
  // Cover-page/document templates. Super Admin and Administrator hold the
  // `documents` permission implicitly (the permission check always passes for
  // them), so this is their way in without switching to the Admin panel.
  { to: '/super-admin/document-templates', label: 'Document Templates', icon: FileText, flag: 'documentGeneratorEnabled', permission: 'documents' },
  { to: '/super-admin/notifications', label: 'Notifications', icon: Bell, permission: 'notifications' },
  { to: '/super-admin/error-logs', label: 'Error Logs', icon: AlertTriangle },
  { to: '/super-admin/system', label: 'System Management', icon: Settings },
  { to: '/super-admin/manual', label: 'User Manual', icon: HelpCircle },
];

export default function SuperAdminLayout() {
  const { isAdministrator } = useAuth();
  return <DashboardShell title={isAdministrator ? 'Administrator' : 'Super Admin'} links={links} />;
}
