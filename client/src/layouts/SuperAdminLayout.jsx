import { LayoutDashboard, Users2, FileStack, Settings, GraduationCap, MessageSquareText, MessageCircle, Mail, Layers3, Bell } from 'lucide-react';
import DashboardShell from './DashboardShell.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const links = [
  { to: '/super-admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/super-admin/users', label: 'All Users', icon: Users2 },
  { to: '/super-admin/faculty', label: 'Faculty', icon: GraduationCap },
  { to: '/super-admin/files', label: 'All Files', icon: FileStack },
  { to: '/super-admin/feedback', label: 'Feedback', icon: MessageSquareText },
  { to: '/super-admin/messages', label: 'Messages', icon: MessageCircle, flag: 'messagingSystemEnabled' },
  { to: '/super-admin/emails', label: 'Email Center', icon: Mail, flag: 'emailSystemEnabled' },
  { to: '/super-admin/enrollments', label: 'Course Enrollment', icon: Layers3, flag: 'courseEnrollmentSystemEnabled' },
  { to: '/super-admin/notifications', label: 'Notifications', icon: Bell, permission: 'notifications' },
  { to: '/super-admin/system', label: 'System Management', icon: Settings },
];

export default function SuperAdminLayout() {
  const { isAdministrator } = useAuth();
  return <DashboardShell title={isAdministrator ? 'Administrator' : 'Super Admin'} links={links} />;
}
