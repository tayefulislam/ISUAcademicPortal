import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { departmentApi, batchApi, semesterApi, routineApi } from '../api/endpoints.js';
import SearchableSelect from '../components/SearchableSelect.jsx';

const initialForm = { name: '', email: '', password: '', rollNo: '', phone: '', department: '', batch: '', semester: '', group: '' };

// Student ID (the verification photo) is deliberately NOT collected here —
// it's a post-registration workflow now (see PendingApproval.jsx / the
// /student-id/submit endpoint). Whether a given student ends up needing one
// at all is decided server-side, after their email is verified, based on
// whether it's an official university email (see authController.js's
// isOfficialUniversityEmail) — registration itself never has to know or ask.
export default function Register() {
  const [form, setForm] = useState(initialForm);
  const [submitting, setSubmitting] = useState(false);
  const { register } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });

  // The class groups this deployment recognises (BOTH, A1, A2 …), read from the
  // server rather than hardcoded so splitting a batch further needs no client
  // change. This one route is deliberately reachable without a session —
  // registration is exactly where it is first needed.
  const { data: groupsData } = useQuery({ queryKey: ['routine', 'groups'], queryFn: routineApi.groups });
  const groupOptions = (groupsData?.data?.groups || []).map((g) => ({
    value: g,
    label: g === 'BOTH' ? 'Both (whole batch)' : g,
  }));

  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  const submit = async (e) => {
    e.preventDefault();
    if (!/^\d{16}$/.test(form.rollNo.trim())) {
      return toast('Student ID must be exactly 16 digits', 'error');
    }
    if (!/^01\d{9}$/.test(form.phone.trim())) {
      return toast('Phone number must be exactly 11 digits and start with 01', 'error');
    }
    if (!form.group) {
      // The group decides which half of the batch's timetable this student is
      // shown. Left unanswered it silently means the whole batch, which is how the
      // group split ends up doing nothing — so this is a real question, and
      // "Both (whole batch)" is a real answer for an unsplit batch.
      return toast('Select your class group', 'error');
    }
    setSubmitting(true);
    try {
      const result = await register(form);
      // `nextStep` is computed server-side (registrationFlowService.js) —
      // the single source of truth this page just routes on, rather than
      // re-deriving the same decision from raw approvalStatus/requiresOtp
      // fields here too.
      if (result.nextStep === 'EMAIL_VERIFICATION') {
        navigate('/verify-otp', { state: { email: form.email } });
      } else if (result.nextStep === 'STUDENT_ID_SUBMISSION' || result.nextStep === 'WAITING_FOR_APPROVAL') {
        toast('Account created — please submit your Student ID to complete verification', 'success');
        navigate('/pending-approval');
      } else {
        toast('Account created — your student account has been automatically approved', 'success');
        navigate('/dashboard');
      }
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
        <Field label="Roll / Student ID">
          <input
            required
            inputMode="numeric"
            pattern="\d{16}"
            maxLength={16}
            title="Student ID must be exactly 16 digits"
            value={form.rollNo}
            onChange={(e) => set('rollNo')(e.target.value.replace(/\D/g, '').slice(0, 16))}
            className="input"
            placeholder="e.g. 0962610005101052 ( Enter 16 digit ID Number )"
          />
          {form.rollNo.length > 0 && form.rollNo.length !== 16 && (
            <p className="text-xs text-red-600 mt-1">Student ID must be exactly 16 digits ({form.rollNo.length}/16)</p>
          )}
        </Field>
        <Field label="Phone Number">
          <input
            required
            inputMode="numeric"
            pattern="01\d{9}"
            maxLength={11}
            title="Phone number must be exactly 11 digits and start with 01"
            value={form.phone}
            onChange={(e) => set('phone')(e.target.value.replace(/\D/g, '').slice(0, 11))}
            className="input"
            placeholder="e.g. 01712345678"
          />
          {form.phone.length > 0 && (form.phone.length !== 11 || !form.phone.startsWith('01')) && (
            <p className="text-xs text-red-600 mt-1">Must be exactly 11 digits and start with 01 ({form.phone.length}/11)</p>
          )}
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
        <Field label="Group">
          <select required value={form.group} onChange={(e) => set('group')(e.target.value)} className="input">
            <option value="">Select group</option>
            {groupOptions.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">
            Which half of your batch you are in. Choose &quot;Both (whole batch)&quot; if your batch is not split.
          </p>
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
