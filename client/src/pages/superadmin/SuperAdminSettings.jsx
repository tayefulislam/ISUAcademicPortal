import { useQuery, useQueryClient } from '@tanstack/react-query';
import { superAdminApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

function ToggleCard({ title, description, enabled, onToggle }) {
  return (
    <div className="max-w-xl bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">{title}</h2>
      <p className="text-sm text-slate-500 mb-4">{description}</p>
      <div className="flex items-center gap-3">
        <button
          onClick={onToggle}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
            enabled ? 'bg-brand-600' : 'bg-slate-300'
          }`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
        <span className="text-sm font-medium text-slate-700">{enabled ? 'ON' : 'OFF'}</span>
      </div>
    </div>
  );
}

export default function SuperAdminSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['system-settings'], queryFn: superAdminApi.getSettings });

  const approvalEnabled = !!data?.data?.studentApprovalEnabled;
  const uploadEnabled = !!data?.data?.studentUploadEnabled;

  const toggle = async (key, current, label) => {
    try {
      await superAdminApi.updateSettings({ [key]: !current });
      toast(`${label} turned ${!current ? 'ON' : 'OFF'}`, 'success');
      qc.invalidateQueries({ queryKey: ['system-settings'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Update failed', 'error');
    }
  };

  if (isLoading) return <p className="text-slate-400">Loading...</p>;

  return (
    <div className="space-y-6">
      <ToggleCard
        title="Student Approval System"
        description="When ON, new student registrations require an ID photo and Admin approval before they can access restricted materials. When OFF, students register and get access immediately (existing department/batch/semester restrictions still apply)."
        enabled={approvalEnabled}
        onToggle={() => toggle('studentApprovalEnabled', approvalEnabled, 'Student approval system')}
      />
      <ToggleCard
        title="Student Material Upload"
        description="When ON, students can submit their own materials — every submission requires Admin/Super Admin/Faculty approval before it becomes visible to anyone else. When OFF, students cannot submit materials; existing approved materials remain available."
        enabled={uploadEnabled}
        onToggle={() => toggle('studentUploadEnabled', uploadEnabled, 'Student material upload')}
      />
    </div>
  );
}
