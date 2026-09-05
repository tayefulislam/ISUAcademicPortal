import { NavLink, Outlet, Link } from 'react-router-dom';
import {
  LayoutDashboard,
  FileStack,
  Upload,
  Building2,
  BookOpen,
  Users2,
  Tags,
  ArrowLeft,
} from 'lucide-react';

const links = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/files', label: 'Files', icon: FileStack },
  { to: '/admin/upload', label: 'Upload', icon: Upload },
  { to: '/admin/departments', label: 'Departments', icon: Building2 },
  { to: '/admin/courses', label: 'Courses', icon: BookOpen },
  { to: '/admin/batches', label: 'Batches', icon: Users2 },
  { to: '/admin/categories', label: 'Categories', icon: Tags },
];

const linkClass = ({ isActive }) =>
  `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
    isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;

export default function AdminLayout() {
  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-64 shrink-0 bg-white border-r border-slate-200 hidden md:flex flex-col">
        <div className="h-16 flex items-center px-5 border-b border-slate-200 font-bold text-brand-700">
          Admin Panel
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
              <l.icon size={18} /> {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-200">
          <Link to="/" className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500 hover:text-brand-700">
            <ArrowLeft size={16} /> Back to site
          </Link>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <div className="md:hidden overflow-x-auto flex gap-1 p-2 bg-white border-b border-slate-200">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={linkClass}>
              <l.icon size={16} /> {l.label}
            </NavLink>
          ))}
        </div>
        <div className="p-4 sm:p-6 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
