import { Link, NavLink, useNavigate } from 'react-router-dom';
import { GraduationCap, LayoutDashboard, ShieldCheck, Bookmark, User, LogOut, Menu, X, UploadCloud, ClipboardCheck } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const navLinkClass = ({ isActive }) =>
  `px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive ? 'text-brand-700 bg-brand-50' : 'text-slate-600 hover:text-brand-700 hover:bg-slate-100'
  }`;

export default function Navbar() {
  const { user, logout, isAdmin, isSuperAdmin, isFaculty } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

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
        </nav>

        <div className="hidden md:flex items-center gap-1">
          {user && (
            <Link
              to="/dashboard"
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <LayoutDashboard size={16} /> Dashboard
            </Link>
          )}
          {user && (
            <Link
              to="/my-bookmarks"
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <Bookmark size={16} /> Bookmarks
            </Link>
          )}
          {user?.role === 'student' && (
            <Link
              to="/submit-material"
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <UploadCloud size={16} /> Submit Material
            </Link>
          )}
          {isFaculty && (
            <Link
              to="/faculty"
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <ClipboardCheck size={16} /> Faculty
            </Link>
          )}
          {isAdmin && (
            <Link
              to="/admin"
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <LayoutDashboard size={16} /> Admin
            </Link>
          )}
          {isSuperAdmin && (
            <Link
              to="/super-admin"
              className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100"
            >
              <ShieldCheck size={16} /> Super Admin
            </Link>
          )}
          {user ? (
            <>
              <Link
                to="/profile"
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                <User size={16} /> {user.name?.split(' ')[0]}
              </Link>
              <button
                onClick={() => {
                  logout();
                  navigate('/');
                }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                <LogOut size={16} /> Logout
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className="ml-1 px-4 py-2 rounded-md text-sm font-semibold text-white bg-brand-600 hover:bg-brand-700"
            >
              Sign in
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
          {user && (
            <NavLink to="/dashboard" className={navLinkClass} onClick={() => setOpen(false)}>
              Dashboard
            </NavLink>
          )}
          {user && (
            <NavLink to="/my-bookmarks" className={navLinkClass} onClick={() => setOpen(false)}>
              My Bookmarks
            </NavLink>
          )}
          {user?.role === 'student' && (
            <NavLink to="/submit-material" className={navLinkClass} onClick={() => setOpen(false)}>
              Submit Material
            </NavLink>
          )}
          {isFaculty && (
            <NavLink to="/faculty" className={navLinkClass} onClick={() => setOpen(false)}>
              Faculty
            </NavLink>
          )}
          {isAdmin && (
            <NavLink to="/admin" className={navLinkClass} onClick={() => setOpen(false)}>
              Admin
            </NavLink>
          )}
          {isSuperAdmin && (
            <NavLink to="/super-admin" className={navLinkClass} onClick={() => setOpen(false)}>
              Super Admin
            </NavLink>
          )}
          {user ? (
            <>
              <NavLink to="/profile" className={navLinkClass} onClick={() => setOpen(false)}>
                Profile
              </NavLink>
              <button
                onClick={() => {
                  logout();
                  setOpen(false);
                  navigate('/');
                }}
                className="text-left px-3 py-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100"
              >
                Logout
              </button>
            </>
          ) : (
            <Link
              to="/login"
              onClick={() => setOpen(false)}
              className="px-3 py-2 rounded-md text-sm font-semibold text-white bg-brand-600 text-center"
            >
              Sign in
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
