import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, KeyRound, Pencil } from 'lucide-react';
import { profileApi, authApi, departmentApi, batchApi, semesterApi, routineApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { formatDate } from '../utils/format.js';

const ROLE_LABEL = { student: 'Student', admin: 'Admin', super_admin: 'Super Admin' };

export default function Profile() {
  const { updateUser, applyToken, isAdminTier } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['my-profile'], queryFn: profileApi.get });
  const profile = data?.data;
  // Student, or a CR-like custom admin-tier role (still a student underneath)
  // — Department/Batch are academic-record fields, not self-editable for
  // these two roles. Mirrors profileController.js's resolveEditableFields;
  // the backend is the actual enforcement, this only disables the inputs.
  const deptBatchLocked = profile?.role === 'student' || (isAdminTier && profile?.role !== 'admin');

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });

  // The configured class groups. Editable here, unlike Department/Batch: a group
  // only decides which part of the student's OWN batch's timetable they are shown,
  // so it is theirs to state — and to correct if they got it wrong at registration.
  const { data: groupsData } = useQuery({ queryKey: ['routine', 'groups'], queryFn: routineApi.groups });
  const groupOptions = (groupsData?.data?.groups || []).map((g) => ({
    value: g,
    label: g === 'BOTH' ? 'Both (whole batch)' : g,
  }));

  useEffect(() => {
    if (profile && !form) {
      setForm({
        name: profile.name,
        rollNo: profile.rollNo || '',
        phone: profile.phone || '',
        department: profile.department?._id || '',
        batch: profile.batch?._id || '',
        semester: profile.semester?._id || '',
        group: profile.group || '',
      });
    }
  }, [profile, form]);

  const saveProfile = async (e) => {
    e.preventDefault();
    try {
      const res = await profileApi.update(form);
      updateUser(res.data);
      toast('Profile updated successfully', 'success');
      setEditing(false);
      qc.invalidateQueries({ queryKey: ['my-profile'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Update failed', 'error');
    }
  };

  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
  const [pwSubmitting, setPwSubmitting] = useState(false);

  const changePassword = async (e) => {
    e.preventDefault();
    if (pwForm.newPassword !== pwForm.confirmNewPassword) {
      return toast('New password and confirmation do not match', 'error');
    }
    setPwSubmitting(true);
    try {
      const res = await authApi.changePassword(pwForm);
      applyToken(res.data.token);
      toast('Password changed successfully', 'success');
      setPwForm({ currentPassword: '', newPassword: '', confirmNewPassword: '' });
    } catch (err) {
      toast(err.response?.data?.message || 'Password change failed', 'error');
    } finally {
      setPwSubmitting(false);
    }
  };

  if (isLoading || !profile) {
    return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-slate-400">Loading profile...</div>;
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-slate-800">My Profile</h1>

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-700">Profile Details</h2>
          {!editing && (
            <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-sm text-brand-600 font-medium hover:underline">
              <Pencil size={14} /> Edit Profile
            </button>
          )}
        </div>

        {!editing ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <Detail label="Name" value={profile.name} />
            <Detail label="Email" value={profile.email} />
            <Detail label="Roll No" value={profile.rollNo || '-'} />
            <Detail label="Phone" value={profile.phone || '-'} />
            <Detail label="Role" value={ROLE_LABEL[profile.role]} />
            <Detail label="Department" value={profile.department ? `${profile.department.name} (${profile.department.code})` : '-'} />
            <Detail label="Batch" value={profile.batch?.name || '-'} />
            <Detail label="Semester" value={profile.semester?.name || '-'} />
            <Detail label="Group" value={groupLabel(profile.group)} />
            <Detail label="Joined" value={formatDate(profile.createdAt)} />
          </div>
        ) : (
          <form onSubmit={saveProfile} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Name">
                <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
              </Field>
              <Field label="Roll No">
                <input value={form.rollNo} onChange={(e) => setForm({ ...form, rollNo: e.target.value })} className="input" />
              </Field>
              <Field label="Phone">
                <input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 11) })}
                  inputMode="numeric"
                  maxLength={11}
                  placeholder="e.g. 01712345678"
                  className="input"
                />
              </Field>
              <Field label="Department">
                {deptBatchLocked ? (
                  <input value={profile.department ? `${profile.department.name} (${profile.department.code})` : 'Not set'} disabled className="input bg-slate-100 text-slate-500" />
                ) : (
                  <select value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} className="input">
                    <option value="">Select</option>
                    {(departments?.data || []).map((d) => <option key={d._id} value={d._id}>{d.name} ({d.code})</option>)}
                  </select>
                )}
              </Field>
              <Field label="Batch">
                {deptBatchLocked ? (
                  <input value={profile.batch?.name || 'Not set'} disabled className="input bg-slate-100 text-slate-500" />
                ) : (
                  <select value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} className="input">
                    <option value="">Select</option>
                    {(batches?.data || []).map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Semester">
                <select value={form.semester} onChange={(e) => setForm({ ...form, semester: e.target.value })} className="input">
                  <option value="">Select</option>
                  {(semesters?.data || []).map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                </select>
              </Field>
              <Field label="Group">
                <select value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} className="input">
                  <option value="">Select</option>
                  {groupOptions.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
                  {/* Keep whatever is stored selectable even if the list has not
                      loaded (or no longer offers it): a select that silently shows
                      nothing is how a group gets blanked by accident. */}
                  {form.group && !groupOptions.some((g) => g.value === form.group) && (
                    <option value={form.group}>{form.group}</option>
                  )}
                </select>
              </Field>
            </div>
            {deptBatchLocked && (
              <p className="text-xs text-slate-400">
                Department and Batch are set by the academic office and can't be changed here.
              </p>
            )}
            <div className="flex gap-2">
              <button className="px-4 h-10 rounded-lg bg-brand-600 text-white font-semibold text-sm">Save Changes</button>
              <button type="button" onClick={() => setEditing(false)} className="px-4 h-10 rounded-lg border border-slate-300 text-sm">Cancel</button>
            </div>
          </form>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <KeyRound size={16} /> Change Password
        </h2>
        <form onSubmit={changePassword} className="space-y-3 max-w-sm">
          <input
            type="password"
            required
            placeholder="Current Password"
            value={pwForm.currentPassword}
            onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
            className="input"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="New Password"
            value={pwForm.newPassword}
            onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
            className="input"
          />
          <input
            type="password"
            required
            placeholder="Confirm New Password"
            value={pwForm.confirmNewPassword}
            onChange={(e) => setPwForm({ ...pwForm, confirmNewPassword: e.target.value })}
            className="input"
          />
          <button disabled={pwSubmitting} className="px-4 h-10 rounded-lg bg-brand-600 text-white font-semibold text-sm disabled:opacity-60">
            {pwSubmitting ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-slate-700 flex items-center gap-2">
            <Bookmark size={16} /> My Bookmarks
          </h2>
          <p className="text-sm text-slate-500 mt-1">View and manage files you've bookmarked.</p>
        </div>
        <Link to="/my-bookmarks" className="px-4 h-10 flex items-center rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50">
          View Bookmarks
        </Link>
      </div>

      <style>{`.input { width: 100%; height: 2.5rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; }
      .input:focus { outline: none; box-shadow: 0 0 0 2px #3a66f5; border-color: transparent; }`}</style>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-slate-400 text-xs uppercase font-medium">{label}</p>
      <p className="text-slate-700 font-medium">{value}</p>
    </div>
  );
}

/** "A1" reads as itself; BOTH is the whole batch and should say so. */
function groupLabel(value) {
  if (!value) return '-';
  return value === 'BOTH' ? 'Both (whole batch)' : value;
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
