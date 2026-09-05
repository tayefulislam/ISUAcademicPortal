import { LayoutDashboard, FileStack, Upload } from 'lucide-react';
import DashboardShell from './DashboardShell.jsx';

const links = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/files', label: 'My Files', icon: FileStack },
  { to: '/admin/upload', label: 'Upload File', icon: Upload },
];

export default function AdminLayout() {
  return <DashboardShell title="Admin Panel" links={links} />;
}
