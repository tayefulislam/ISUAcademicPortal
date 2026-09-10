import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { authApi } from '../api/endpoints.js';

export default function Login() {
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [submitting, setSubmitting] = useState(false);
  const { login } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // Which identifiers are currently accepted — Super Admin can turn
  // Student ID / Phone login off independently (Settings.js), so the label
  // reflects whatever's actually enabled right now rather than always
  // claiming all three work.
  const { data: settings } = useQuery({ queryKey: ['public-settings'], queryFn: authApi.publicSettings, staleTime: 60_000 });
  const identifierParts = ['Email'];
  if (settings?.data?.studentIdLoginEnabled) identifierParts.push('Student ID');
  if (settings?.data?.phoneLoginEnabled) identifierParts.push('Phone');
  const identifierLabel = identifierParts.join(' / ');

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(form);
      toast('Signed in successfully', 'success');
      navigate(location.state?.from?.pathname || '/');
    } catch (err) {
      if (err.response?.data?.code === 'EMAIL_NOT_VERIFIED') {
        // Only pre-fill the verify-OTP page's email when the typed
        // identifier actually looks like one — a rollNo/phone login on an
        // unverified account has no email to hand off client-side.
        if (form.identifier.includes('@')) {
          navigate('/verify-otp', { state: { email: form.identifier } });
          return;
        }
        toast('Please verify your email before logging in — check your inbox for the code, or sign in with your email to continue.', 'error');
        return;
      }
      toast(err.response?.data?.message || 'Login failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Sign in</h1>
      <p className="text-sm text-slate-500 mb-6">Access uploads and admin tools.</p>

      <form onSubmit={submit} className="space-y-4 bg-white border border-slate-200 rounded-xl p-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">{identifierLabel}</label>
          <input
            required
            autoComplete="username"
            value={form.identifier}
            onChange={(e) => setForm({ ...form, identifier: e.target.value })}
            placeholder={identifierLabel}
            className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-slate-700">Password</label>
            <Link to="/forgot-password" className="text-xs text-brand-600 hover:underline">Forgot password?</Link>
          </div>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <button
          disabled={submitting}
          className="w-full h-11 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-60"
        >
          {submitting ? 'Signing in...' : 'Sign in'}
        </button>
      </form>

      <p className="text-sm text-slate-500 mt-4 text-center">
        Don&apos;t have an account?{' '}
        <Link to="/register" className="text-brand-600 font-medium hover:underline">
          Register
        </Link>
      </p>
    </div>
  );
}
