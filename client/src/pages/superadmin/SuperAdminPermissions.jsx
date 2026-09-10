import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ShieldCheck, GraduationCap } from 'lucide-react';
import { roleApi, superAdminApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

// Super Admin manages admin-tier roles here: toggle which menu items/actions
// each role can reach, and add further roles beyond the seeded "Admin" (e.g.
// "CR") — optionally starting as an exact copy of an existing role's
// permissions. Student/Faculty/Super Admin aren't roles managed here — they
// keep their own hardcoded access model untouched.
export default function SuperAdminPermissions() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['roles'], queryFn: roleApi.list });
  const { data: settingsData } = useQuery({ queryKey: ['system-settings'], queryFn: superAdminApi.getSettings });
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [copyFrom, setCopyFrom] = useState('');
  const [creating, setCreating] = useState(false);

  const roles = data?.data || [];
  const modules = data?.modules || [];
  const facultyChapterTopicEnabled = !!settingsData?.data?.facultyChapterTopicEnabled;

  const toggleFacultyChapterTopic = async () => {
    try {
      await superAdminApi.updateSettings({ facultyChapterTopicEnabled: !facultyChapterTopicEnabled });
      toast(`Faculty Chapter/Topic creation turned ${!facultyChapterTopicEnabled ? 'ON' : 'OFF'}`, 'success');
      qc.invalidateQueries({ queryKey: ['system-settings'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Update failed', 'error');
    }
  };

  const togglePermission = async (role, key) => {
    const next = role.permissions.includes(key) ? role.permissions.filter((p) => p !== key) : [...role.permissions, key];
    try {
      await roleApi.updatePermissions(role.key, next);
      qc.invalidateQueries({ queryKey: ['roles'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Update failed', 'error');
    }
  };

  const createRole = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      await roleApi.create({ name: newName, copyFrom: copyFrom || undefined });
      toast(`Role "${newName}" created`, 'success');
      setNewName('');
      setCopyFrom('');
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ['roles'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Could not create role', 'error');
    } finally {
      setCreating(false);
    }
  };

  const removeRole = async (role) => {
    if (!confirm(`Delete the "${role.name}" role? This cannot be undone.`)) return;
    try {
      await roleApi.remove(role.key);
      toast('Role deleted', 'success');
      qc.invalidateQueries({ queryKey: ['roles'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed', 'error');
    }
  };

  if (isLoading) return <p className="text-slate-400">Loading...</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold text-slate-800">Roles & Permissions</h1>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold"
        >
          <Plus size={16} /> Add Role
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Turn menu items and actions ON or OFF per role. Super Admin always has full access and isn't shown here.
      </p>

      {showAdd && (
        <form onSubmit={createRole} className="bg-white border border-slate-200 rounded-xl p-4 mb-6 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Role name</label>
            <input
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. CR"
              className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Start with permissions from</label>
            <select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm">
              <option value="">None (start empty)</option>
              {roles.map((r) => (
                <option key={r.key} value={r.key}>{r.name}</option>
              ))}
            </select>
          </div>
          <button disabled={creating} className="h-10 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold disabled:opacity-60">
            {creating ? 'Creating...' : 'Create'}
          </button>
        </form>
      )}

      <div className="mb-8">
        <h2 className="text-lg font-semibold text-slate-800 mb-1 flex items-center gap-1.5">
          <GraduationCap size={18} /> Faculty Permissions
        </h2>
        <p className="text-sm text-slate-500 mb-3">
          Faculty aren't managed through the role grid below — they keep their own Department/Course-scoped access. This
          controls the one extra capability Super Admin can grant them.
        </p>
        <div className="bg-white border border-slate-200 rounded-xl p-4 max-w-xl flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-slate-700">Create Chapter/Topic</p>
            <p className="text-xs text-slate-500 mt-0.5">
              When ON, Faculty can create Chapters and Topics for their own assigned Department(s)/Course(s). Editing/deleting stays Super Admin-only.
            </p>
          </div>
          <button
            onClick={toggleFacultyChapterTopic}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
              facultyChapterTopicEnabled ? 'bg-brand-600' : 'bg-slate-300'
            }`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${facultyChapterTopicEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      <h2 className="text-lg font-semibold text-slate-800 mb-3">Admin-tier Roles</h2>
      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="p-3 text-left sticky left-0 bg-slate-50">Role</th>
              {modules.map((m) => (
                <th key={m.key} className="p-3 text-center whitespace-nowrap" title={m.description}>{m.label}</th>
              ))}
              <th className="p-3 text-left">Users</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-slate-100 bg-purple-50/40">
              <td className="p-3 font-medium text-purple-700 sticky left-0 bg-purple-50/40 flex items-center gap-1.5">
                <ShieldCheck size={14} /> Super Admin
              </td>
              {modules.map((m) => (
                <td key={m.key} className="p-3 text-center text-purple-400">✓</td>
              ))}
              <td className="p-3 text-slate-400">—</td>
              <td className="p-3 text-slate-400 text-xs">Always full access</td>
            </tr>
            {roles.map((role) => (
              <tr key={role.key} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="p-3 font-medium text-slate-700 sticky left-0 bg-white">{role.name}</td>
                {modules.map((m) => (
                  <td key={m.key} className="p-3 text-center">
                    <input
                      type="checkbox"
                      checked={role.permissions.includes(m.key)}
                      onChange={() => togglePermission(role, m.key)}
                    />
                  </td>
                ))}
                <td className="p-3 text-slate-500">{role.userCount}</td>
                <td className="p-3">
                  {!role.isProtected && (
                    <button
                      onClick={() => removeRole(role)}
                      title={role.userCount > 0 ? 'Reassign all users with this role first' : 'Delete role'}
                      disabled={role.userCount > 0}
                      className="p-1.5 rounded hover:bg-red-50 text-red-600 disabled:opacity-30 disabled:hover:bg-transparent"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
