import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// A 401 here always means the session itself is no longer valid — either the
// token expired, or the server bumped tokenVersion (password change, block/
// unblock, role change, or a student approval/rejection decision — see
// authController.js's login() and studentApprovalController.js) to force a
// re-check. There's no live/periodic refetch of the user's own role or
// approval status (see AuthContext.jsx) — a fresh login is what actually
// picks up the change, so this redirects there immediately instead of
// leaving a stale, silently-broken session in place until something else
// happens to reload the page.
const AUTH_ENDPOINTS = ['/auth/login', '/auth/register', '/auth/verify-otp', '/auth/send-otp', '/auth/forgot-password', '/auth/reset-password'];

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || '';
      const isAuthEndpoint = AUTH_ENDPOINTS.some((p) => url.includes(p));
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (!isAuthEndpoint && window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
