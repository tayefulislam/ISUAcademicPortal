import { LayoutDashboard, Users2, UserCheck, UserX, FileStack, Settings, GraduationCap, MessageSquareText, Flag, MessageCircle, Mail, Layers3, Bell, HelpCircle, AlertTriangle, CalendarDays, CalendarClock, FileText, PenSquare, Sparkles, HardDrive, Upload } from 'lucide-react';
import DashboardShell from './DashboardShell.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const links = [
  { to: '/super-admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/super-admin/users', label: 'All Users', icon: Users2 },
  { to: '/super-admin/approvals', label: 'Student Approvals', icon: UserCheck },
  { to: '/super-admin/faculty', label: 'Faculty', icon: GraduationCap },
  { to: '/super-admin/files', label: 'All Files', icon: FileStack },
  // Publishing material. Super Admin and Administrator hold every permission
  // implicitly (the check always passes for them), so `files` is their way in
  // without switching to the Admin panel.
  { to: '/super-admin/upload', label: 'Upload File', icon: Upload, permission: 'files' },
  // The universal pipeline's institution-wide storage figures.
  { to: '/super-admin/storage', label: 'Storage', icon: HardDrive },
  { to: '/super-admin/feedback', label: 'Feedback', icon: MessageSquareText },
  { to: '/super-admin/reports', label: 'Reports', icon: Flag },
  { to: '/super-admin/messages', label: 'Messages', icon: MessageCircle, flag: 'messagingSystemEnabled' },
  { to: '/super-admin/emails', label: 'Email Center', icon: Mail, flag: 'emailSystemEnabled' },
  { to: '/super-admin/enrollments', label: 'Course Enrollment', icon: Layers3, flag: 'courseEnrollmentSystemEnabled' },
  { to: '/super-admin/routine', label: 'Routine Manager', icon: CalendarDays, flag: 'routineSystemEnabled' },
  { to: '/routine', label: 'My Calendar', icon: CalendarClock, flag: 'routineSystemEnabled' },
  // Cover-page/document templates. Super Admin and Administrator hold the
  // `documents` permission implicitly (the permission check always passes for
  // them), so this is their way in without switching to the Admin panel.
  { to: '/super-admin/document-templates', label: 'Document Templates', icon: FileText, flag: 'documentGeneratorEnabled', permission: 'documents' },
  // Write Application — the types, recipients and the AI credit ledger.
  { to: '/super-admin/application-types', label: 'Application Types', icon: PenSquare, flag: 'applicationWriterEnabled', permission: 'applications' },
  { to: '/super-admin/application-recipients', label: 'Application Recipients', icon: UserCheck, flag: 'applicationWriterEnabled', permission: 'applications' },
  { to: '/super-admin/ai-credits', label: 'AI Credits', icon: Sparkles, flag: 'applicationWriterEnabled', permission: 'applications' },
  { to: '/super-admin/notifications', label: 'Notifications', icon: Bell, permission: 'notifications' },
  { to: '/super-admin/error-logs', label: 'Error Logs', icon: AlertTriangle },
  { to: '/super-admin/system', label: 'System Management', icon: Settings },
  { to: '/super-admin/account-deletions', label: 'Deletion Requests', icon: UserX },
  { to: '/super-admin/manual', label: 'User Manual', icon: HelpCircle },
];

export default function SuperAdminLayout() {
  const { isAdministrator } = useAuth();
  return <DashboardShell title={isAdministrator ? 'Administrator' : 'Super Admin'} links={links} />;
}
