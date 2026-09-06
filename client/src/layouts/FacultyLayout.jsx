import { LayoutDashboard, FileStack, ClipboardCheck } from 'lucide-react';
import DashboardShell from './DashboardShell.jsx';

const links = [
  { to: '/faculty', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/faculty/reviews', label: 'Review Submissions', icon: ClipboardCheck },
  { to: '/faculty/files', label: 'Assigned Materials', icon: FileStack },
];

export default function FacultyLayout() {
  return <DashboardShell title="Faculty Panel" links={links} />;
}
