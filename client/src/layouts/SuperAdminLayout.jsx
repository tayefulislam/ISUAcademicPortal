import { LayoutDashboard, Users2, FileStack, Settings } from 'lucide-react';
import DashboardShell from './DashboardShell.jsx';

const links = [
  { to: '/super-admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/super-admin/users', label: 'All Users', icon: Users2 },
  { to: '/super-admin/files', label: 'All Files', icon: FileStack },
  { to: '/super-admin/system', label: 'System Management', icon: Settings },
];

export default function SuperAdminLayout() {
  return <DashboardShell title="Super Admin" links={links} />;
}
