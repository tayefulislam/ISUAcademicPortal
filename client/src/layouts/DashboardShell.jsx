import { useState } from 'react';
import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Menu, X, LogOut } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.jsx';
import { authApi } from '../api/endpoints.js';
import NotificationBell from '../components/notifications/NotificationBell.jsx';

const linkClass = ({ isActive }) =>
  `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
    isActive ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`;

// Shared sidebar shell for the Faculty/Admin/Super Admin panels — only the
// title and nav links differ between them. The header's menu button opens
// the sidebar as an off-canvas drawer on mobile, and collapses it to an
// icon rail on desktop. A link can carry:
//   - `flag`: a Settings.FEATURE_FLAGS key — hidden while Super Admin has
//     that feature toggled OFF globally (e.g. Messages/Email Center).
//   - `permission`: a Role permission key — hidden unless the current
//     admin-tier user's role (Admin, "CR", ...) has been granted it via the
//     Permissions page. Ignored for Super Admin, who always has everything.
//   - `excludeRoles`: an array of exact role strings — hidden for those
//     roles specifically (e.g. hiding a "act as a student" link from the
//     unrestricted 'admin' role while still showing it to a custom role
//     like "CR").
export default function DashboardShell({ title, links }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const closeMobile = () => setMobileOpen(false);
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const { data: settings } = useQuery({ queryKey: ['public-settings'], queryFn: authApi.publicSettings, staleTime: 60_000 });

  const visibleLinks = links.filter(
    (l) =>
      (!l.flag || settings?.data?.[l.flag] !== false) &&
      (!l.permission || hasPermission(l.permission)) &&
      (!l.excludeRoles || !l.excludeRoles.includes(user?.role))
  );

  return (
    <div className="min-h-screen flex bg-slate-50">
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/40 z-30 md:hidden" onClick={closeMobile} />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-64 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 md:transition-[width] md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${collapsed ? 'md:w-[4.5rem]' : 'md:w-64'}`}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-200 font-bold text-brand-700 shrink-0">
          <span className={`truncate ${collapsed ? 'md:hidden' : ''}`}>{title}</span>
          <button onClick={closeMobile} className="md:hidden text-slate-400 hover:text-slate-600" aria-label="Close menu">
            <X size={20} />
          </button>
        </div>
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleLinks.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={linkClass} onClick={closeMobile} title={l.label}>
              <l.icon size={18} className="shrink-0" />
              <span className={collapsed ? 'md:hidden' : ''}>{l.label}</span>
            </NavLink>
          ))}
          <NavLink to="/profile" className={linkClass} onClick={closeMobile} title="Profile">
            <User size={18} className="shrink-0" />
            <span className={collapsed ? 'md:hidden' : ''}>Profile</span>
          </NavLink>
        </nav>
        <div className="p-3 border-t border-slate-200 space-y-0.5">
          <Link to="/" className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-500 hover:text-brand-700" title="Back to site">
            <ArrowLeft size={16} className="shrink-0" />
            <span className={collapsed ? 'md:hidden' : ''}>Back to site</span>
          </Link>
          <button
            onClick={() => {
              logout();
              navigate('/');
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-slate-500 hover:text-red-600"
            title="Logout"
          >
            <LogOut size={16} className="shrink-0" />
            <span className={collapsed ? 'md:hidden' : ''}>Logout</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 shrink-0 flex items-center gap-3 px-4 bg-white border-b border-slate-200 sticky top-0 z-20">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden p-2 -ml-2 rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <button
            onClick={() => setCollapsed((v) => !v)}
            className="hidden md:inline-flex p-2 -ml-2 rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <Menu size={20} />
          </button>
          <span className="font-semibold text-slate-700 md:hidden">{title}</span>
          <div className="ml-auto">
            <NotificationBell />
          </div>
        </header>
        <div className="p-4 sm:p-6 max-w-7xl mx-auto w-full">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
