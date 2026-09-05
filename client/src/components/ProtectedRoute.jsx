import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// This is a UX convenience only — every role/ownership decision that
// actually matters is re-checked by the backend on every request. Hiding a
// nav link or route here never substitutes for a server-side check.
export default function ProtectedRoute({ children, roles, adminOnly = false }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="flex justify-center py-24 text-slate-400">Loading...</div>;
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const allowedRoles = roles || (adminOnly ? ['admin', 'super_admin'] : null);
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/403" replace />;
  }

  return children;
}
