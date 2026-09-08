import { Link, NavLink } from 'react-router-dom';
import { GraduationCap, LayoutDashboard, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.jsx';
import { authApi } from '../api/endpoints.js';
import NotificationBell from './notifications/NotificationBell.jsx';

const navLinkClass = ({ isActive }) =>
  `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive ? 'text-brand-700 bg-brand-50' : 'text-slate-600 hover:text-brand-700 hover:bg-slate-100'
  }`;

// Everything beyond these five public links lives inside the Dashboard —
// for students that's the Dashboard page itself (quick links to Bookmarks,
// Assignments, Quizzes, Messages, Submit Material, Profile, Logout); for
// Faculty/Admin/Super Admin it's their own DashboardShell sidebar, which
// already carries the full feature set plus Profile/Logout. The navbar's
// only job for a signed-in user is to route them into the right one.
export default function Navbar() {
  const { user, isAdmin, isSuperAdminTier, isFaculty } = useAuth();
  const [open, setOpen] = useState(false);
  const { data: settings } = useQuery({ queryKey: ['public-settings'], queryFn: authApi.publicSettings, staleTime: 60_000 });

  const dashboardPath = isSuperAdminTier ? '/super-admin' : isAdmin ? '/admin' : isFaculty ? '/faculty' : '/dashboard';
  const feedbackEnabled = settings?.data?.feedbackSystemEnabled !== false;

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 font-bold text-brand-700 text-lg">
          <GraduationCap className="text-brand-600" />
         ISU Academic Portal
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          <NavLink to="/" className={navLinkClass} end>
            Home
          </NavLink>
          <NavLink to="/search" className={navLinkClass}>
            Browse & Search
          </NavLink>
          <NavLink to="/courses" className={navLinkClass}>
            Courses
          </NavLink>
          <NavLink to="/notices" className={navLinkClass}>
            Notices
          </NavLink>
          {feedbackEnabled && (
            <NavLink to="/feedback" className={navLinkClass}>
              Feedback
            </NavLink>
          )}
        </nav>

        <div className="hidden md:flex items-center gap-1">
          {user ? (
            <>
              <NotificationBell />
              <Link
                to={dashboardPath}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700"
              >
                <LayoutDashboard size={16} /> Dashboard
              </Link>
            </>
          ) : (
            <Link
              to="/login"
              className="px-4 py-2 rounded-md text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700"
            >
              Login
            </Link>
          )}
        </div>

        <button className="md:hidden p-2" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu">
          {open ? <X /> : <Menu />}
        </button>
      </div>

      {open && (
        <div className="md:hidden border-t border-slate-200 px-4 py-3 flex flex-col gap-1 bg-white">
          <NavLink to="/" className={navLinkClass} end onClick={() => setOpen(false)}>
            Home
          </NavLink>
          <NavLink to="/search" className={navLinkClass} onClick={() => setOpen(false)}>
            Browse & Search
          </NavLink>
          <NavLink to="/courses" className={navLinkClass} onClick={() => setOpen(false)}>
            Courses
          </NavLink>
          <NavLink to="/notices" className={navLinkClass} onClick={() => setOpen(false)}>
            Notices
          </NavLink>
          {feedbackEnabled && (
            <NavLink to="/feedback" className={navLinkClass} onClick={() => setOpen(false)}>
              Feedback
            </NavLink>
          )}
          {user ? (
            <NavLink to={dashboardPath} className={navLinkClass} onClick={() => setOpen(false)}>
              Dashboard
            </NavLink>
          ) : (
            <Link
              to="/login"
              onClick={() => setOpen(false)}
              className="px-3 py-2 rounded-md text-sm font-semibold text-white bg-brand-600 text-center"
            >
              Login
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
