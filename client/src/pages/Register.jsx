import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { departmentApi, batchApi, semesterApi, authApi } from '../api/endpoints.js';
import SearchableSelect from '../components/SearchableSelect.jsx';

const initialForm = { name: '', email: '', password: '', rollNo: '', department: '', batch: '', semester: '' };

export default function Register() {
  const [form, setForm] = useState(initialForm);
  const [studentIdImage, setStudentIdImage] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState(false);
  const { register } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });
  const { data: settings } = useQuery({ queryKey: ['public-settings'], queryFn: authApi.publicSettings });

  const approvalEnabled = !!settings?.data?.studentApprovalEnabled;

  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  const submit = async (e) => {
    e.preventDefault();
    if (approvalEnabled && !studentIdImage) {
      return toast('A Student ID photo is required', 'error');
    }
    setSubmitting(true);
    try {
      let payload = form;
      if (approvalEnabled) {
        const fd = new FormData();
        Object.entries(form).forEach(([k, v]) => fd.append(k, v));
        fd.append('studentIdImage', studentIdImage);
        payload = fd;
      }
      const user = await register(payload);
      if (user.approvalStatus === 'pending') {
        setPending(true);
      } else {
        toast('Account created', 'success');
        navigate('/');
      }
    } catch (err) {
      toast(err.response?.data?.message || 'Registration failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (pending) {
    return (
      <div className="max-w-md mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Account created</h1>
        <p className="text-sm text-slate-500">
          Your account is pending Admin approval. You can sign in and browse public materials now, but
          department/batch/semester-restricted materials will unlock once an Admin approves your Student ID.
        </p>
        <Link to="/" className="inline-block mt-6 text-brand-600 font-medium hover:underline">
          Continue to the site
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto px-4 py-16">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Create an account</h1>
      <p className="text-sm text-slate-500 mb-6">Bookmark files and track your activity.</p>

      <form onSubmit={submit} className="space-y-4 bg-white border border-slate-200 rounded-xl p-6">
        <Field label="Name">
          <input required value={form.name} onChange={(e) => set('name')(e.target.value)} className="input" />
        </Field>
        <Field label="Email">
          <input type="email" required value={form.email} onChange={(e) => set('email')(e.target.value)} className="input" />
        </Field>
        <Field label="Password">
          <input
            type="password"
            required
            minLength={6}
            value={form.password}
            onChange={(e) => set('password')(e.target.value)}
            className="input"
          />
        </Field>
        <Field label="Roll No">
          <input required value={form.rollNo} onChange={(e) => set('rollNo')(e.target.value)} className="input" placeholder="e.g. 142030" />
        </Field>
        <Field label="Department">
          <SearchableSelect
            required
            value={form.department}
            onChange={set('department')}
            placeholder="Select department"
            searchPlaceholder="Search departments..."
            options={(departments?.data || []).map((d) => ({ value: d._id, label: `${d.name} (${d.code})` }))}
          />
        </Field>
        <Field label="Batch">
          <SearchableSelect
            required
            value={form.batch}
            onChange={set('batch')}
            placeholder="Select batch"
            searchPlaceholder="Search batches..."
            options={(batches?.data || []).map((b) => ({ value: b._id, label: b.name }))}
          />
        </Field>
        <Field label="Semester">
          <select required value={form.semester} onChange={(e) => set('semester')(e.target.value)} className="input">
            <option value="">Select semester</option>
            {(semesters?.data || []).map((s) => (
              <option key={s._id} value={s._id}>{s.name}</option>
            ))}
          </select>
        </Field>

        {approvalEnabled && (
          <Field label="Student ID Photo">
            <input
              type="file"
              accept="image/*"
              required
              onChange={(e) => setStudentIdImage(e.target.files?.[0] || null)}
              className="input"
            />
            <p className="text-xs text-slate-400 mt-1">
              Used only to verify your identity — Admin will review it to approve your account.
            </p>
          </Field>
        )}

        <button
          disabled={submitting}
          className="w-full h-11 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-60"
        >
          {submitting ? 'Creating...' : 'Create account'}
        </button>
      </form>

      <p className="text-sm text-slate-500 mt-4 text-center">
        Already have an account?{' '}
        <Link to="/login" className="text-brand-600 font-medium hover:underline">
          Sign in
        </Link>
      </p>

      <style>{`.input { width: 100%; height: 2.75rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; }
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
