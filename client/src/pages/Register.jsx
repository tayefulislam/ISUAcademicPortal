import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { departmentApi, batchApi, semesterApi } from '../api/endpoints.js';

const initialForm = { name: '', email: '', password: '', rollNo: '', department: '', batch: '', semester: '' };

export default function Register() {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const { register } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });

  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await register(form);
      toast('Account created', 'success');
      navigate('/');
    } catch (err) {
      toast(err.response?.data?.message || 'Registration failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

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
          <select required value={form.department} onChange={(e) => set('department')(e.target.value)} className="input">
            <option value="">Select department</option>
            {(departments?.data || []).map((d) => (
              <option key={d._id} value={d._id}>{d.name} ({d.code})</option>
            ))}
          </select>
        </Field>
        <Field label="Batch">
          <select required value={form.batch} onChange={(e) => set('batch')(e.target.value)} className="input">
            <option value="">Select batch</option>
            {(batches?.data || []).map((b) => (
              <option key={b._id} value={b._id}>{b.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Semester">
          <select required value={form.semester} onChange={(e) => set('semester')(e.target.value)} className="input">
            <option value="">Select semester</option>
            {(semesters?.data || []).map((s) => (
              <option key={s._id} value={s._id}>{s.name}</option>
            ))}
          </select>
        </Field>

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
