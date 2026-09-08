import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { authApi } from '../api/endpoints.js';

export default function VerifyOtp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { applySession } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState(location.state?.email || '');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const { data } = await authApi.verifyOtp({ email, code });
      applySession(data.token, data.user);
      toast('Email verified — you are signed in', 'success');
      navigate('/');
    } catch (err) {
      toast(err.response?.data?.message || 'Verification failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (!email) return toast('Enter your email first', 'error');
    setResending(true);
    try {
      await authApi.sendOtp(email);
      toast('If that account needs verification, a new code was sent', 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Could not resend code', 'error');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Verify your email</h1>
      <p className="text-sm text-slate-500 mb-6">Enter the 6-digit code we sent to your email address.</p>

      <form onSubmit={submit} className="space-y-4 bg-white border border-slate-200 rounded-xl p-6">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Verification code</label>
          <input
            required
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm tracking-[0.3em] text-center font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="000000"
          />
        </div>
        <button
          disabled={submitting}
          className="w-full h-11 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-60"
        >
          {submitting ? 'Verifying...' : 'Verify'}
        </button>
      </form>

      <p className="text-sm text-slate-500 mt-4 text-center">
        Didn&apos;t get a code?{' '}
        <button onClick={resend} disabled={resending} className="text-brand-600 font-medium hover:underline disabled:opacity-60">
          {resending ? 'Sending...' : 'Resend code'}
        </button>
      </p>
      <p className="text-sm text-slate-500 mt-2 text-center">
        <Link to="/login" className="text-brand-600 font-medium hover:underline">Back to sign in</Link>
      </p>
    </div>
  );
}
