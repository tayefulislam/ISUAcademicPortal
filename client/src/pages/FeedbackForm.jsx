import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { feedbackApi, authApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';

const CATEGORIES = ['Website', 'Academic Material', 'Faculty', 'Technical Issue', 'Suggestion', 'Other'];

const initialForm = { name: '', email: '', category: 'Website', subject: '', message: '' };

export default function FeedbackForm() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [form, setForm] = useState(() => ({ ...initialForm, name: user?.name || '', email: user?.email || '' }));
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const { data: settings, isLoading: loadingSettings } = useQuery({ queryKey: ['public-settings'], queryFn: authApi.publicSettings });
  const enabled = !!settings?.data?.feedbackSystemEnabled;

  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await feedbackApi.submit({ ...form, rating: rating || undefined });
      setSent(true);
    } catch (err) {
      toast(err.response?.data?.message || 'Submission failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingSettings) {
    return <div className="max-w-2xl mx-auto px-4 py-16 text-center text-slate-400">Loading...</div>;
  }

  if (!enabled) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Feedback Unavailable</h1>
        <p className="text-sm text-slate-500">The feedback system is currently turned off by the site administrators.</p>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Thanks for your feedback!</h1>
        <p className="text-sm text-slate-500">We appreciate you taking the time to help us improve.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Feedback</h1>
      <p className="text-sm text-slate-500 mb-6">Tell us what's working, what isn't, or what you'd like to see.</p>

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Name">
            <input required value={form.name} onChange={(e) => set('name')(e.target.value)} className="input" />
          </Field>
          <Field label="Email">
            <input type="email" required value={form.email} onChange={(e) => set('email')(e.target.value)} className="input" />
          </Field>
        </div>

        <Field label="Category">
          <select value={form.category} onChange={(e) => set('category')(e.target.value)} className="input">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>

        <Field label="Subject">
          <input required value={form.subject} onChange={(e) => set('subject')(e.target.value)} className="input" placeholder="Short summary" />
        </Field>

        <Field label="Message">
          <textarea required rows={5} value={form.message} onChange={(e) => set('message')(e.target.value)} className="input" />
        </Field>

        <Field label="Rating (optional)">
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" onClick={() => setRating(n === rating ? 0 : n)} className="p-0.5">
                <Star size={22} className={n <= rating ? 'text-amber-400' : 'text-slate-300'} fill={n <= rating ? 'currentColor' : 'none'} />
              </button>
            ))}
          </div>
        </Field>

        <button disabled={submitting} className="w-full h-11 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-60">
          {submitting ? 'Sending...' : 'Send Feedback'}
        </button>
      </form>

      <style>{`.input { width: 100%; height: 2.75rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; color: #1e293b; }
      textarea.input { height: auto; padding: 0.6rem 0.75rem; }
      .input:focus { outline: none; box-shadow: 0 0 0 2px #3a66f5; border-color: transparent; }`}</style>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
