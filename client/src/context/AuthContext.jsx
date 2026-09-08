import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authApi } from '../api/endpoints.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then(({ data }) => {
        setUser(data.user);
        localStorage.setItem('user', JSON.stringify(data.user));
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (credentials) => {
    const { data } = await authApi.login(credentials);
    localStorage.setItem('token', data.token);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (payload) => {
    const { data } = await authApi.register(payload);
    // No token yet when email OTP verification is required — the caller
    // must route to the OTP-verify step, which is what actually signs in.
    if (data.token) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      setUser(data.user);
    }
    return data;
  }, []);

  const applySession = useCallback((token, sessionUser) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(sessionUser));
    setUser(sessionUser);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  }, []);

  // Applying a fresh token (e.g. after a password change) without a full
  // login round-trip.
  const applyToken = useCallback((token) => {
    localStorage.setItem('token', token);
  }, []);

  // Updates the cached user (e.g. after editing the profile) and keeps
  // localStorage in sync so a page refresh doesn't briefly show stale data.
  const updateUser = useCallback((next) => {
    setUser(next);
    localStorage.setItem('user', JSON.stringify(next));
  }, []);

  const isSuperAdmin = user?.role === 'super_admin';
  const isAdministrator = user?.role === 'administrator';
  // Has every super_admin capability except visibility/control over
  // super_admin accounts themselves (server-enforced) — use this instead of
  // `isSuperAdmin` for any UI that should also be available to Administrator.
  const isSuperAdminTier = isSuperAdmin || isAdministrator;
  const isFaculty = user?.role === 'faculty';
  const isStudent = user?.role === 'student';
  // Any role that isn't Student/Faculty/Super Admin/Administrator sits at
  // the "admin tier" — Admin, "CR", or any further role Super Admin creates
  // via the Permissions page. `isAdmin` keeps its existing broad meaning
  // (used throughout the app for admin-tier UI) so a new admin-tier role
  // behaves like Admin everywhere without touching every call site.
  const isAdminTier = !!user && !isSuperAdminTier && !isFaculty && !isStudent;
  const isAdmin = isSuperAdminTier || isAdminTier;
  const permissions = user?.permissions || [];
  const hasPermission = useCallback((key) => isSuperAdminTier || permissions.includes(key), [isSuperAdminTier, permissions]);

  return (
    <AuthContext.Provider
      value={{
        user,
        updateUser,
        loading,
        login,
        register,
        logout,
        applyToken,
        applySession,
        isAdmin,
        isAdminTier,
        isSuperAdmin,
        isAdministrator,
        isSuperAdminTier,
        isFaculty,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
