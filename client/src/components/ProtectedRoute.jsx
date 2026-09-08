import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// This is a UX convenience only — every role/ownership decision that
// actually matters is re-checked by the backend on every request. Hiding a
// nav link or route here never substitutes for a server-side check.
//
// `adminTier` accepts any admin-tier role (Admin, CR, or any further role
// Super Admin creates) rather than a fixed role-string list, since those
// roles are dynamic — use it instead of `roles={['admin','super_admin']}`.
//
// `orAdminTier` (combined with `roles`) additionally lets any admin-tier
// role through even though its role string isn't in `roles` — e.g.
// roles={['student']} orAdminTier lets a "CR" act as a student too (same
// precedent as Assignment submission / Quiz attempts / Course Enrollment
// requests, all already open to admin-tier roles server-side).
export default function ProtectedRoute({ children, roles, adminOnly = false, adminTier = false, orAdminTier = false }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="flex justify-center py-24 text-slate-400">Loading...</div>;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (adminTier) {
    return isAdmin ? children : <Navigate to="/403" replace />;
  }

  const allowedRoles = roles || (adminOnly ? ['admin', 'super_admin'] : null);
  if (allowedRoles && !allowedRoles.includes(user.role) && !(orAdminTier && isAdmin)) {
    return <Navigate to="/403" replace />;
  }

  return children;
}
