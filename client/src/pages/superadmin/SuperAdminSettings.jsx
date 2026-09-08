import { useState } from 'react';
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

// A non-negative integer limit — 0 always means "unlimited" (see
// Settings.js NUMERIC_SETTINGS). Saves on blur, not on every keystroke.
function NumericLimitCard({ title, description, value, onSave }) {
  const [draft, setDraft] = useState(String(value));
  return (
    <div className="max-w-xl bg-white border border-slate-200 rounded-xl p-6">
      <h2 className="text-lg font-semibold text-slate-800 mb-1">{title}</h2>
      <p className="text-sm text-slate-500 mb-4">{description}</p>
      <div className="flex items-center gap-3">
        <input
          type="number"
          min={0}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const num = Math.max(0, Number(draft) || 0);
            setDraft(String(num));
            if (num !== value) onSave(num);
          }}
          className="w-24 h-10 rounded-lg border border-slate-300 px-3 text-sm"
        />
        <span className="text-sm text-slate-500">{Number(draft) === 0 ? 'Unlimited' : 'max'}</span>
      </div>
    </div>
  );
}

// Feature Management — generic over whatever GET /super-admin/settings
// returns as `flags` (see server models/Settings.js FEATURE_FLAGS). Adding a
// new toggle server-side makes it appear here automatically, no client change.
export default function SuperAdminSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['system-settings'], queryFn: superAdminApi.getSettings });

  const values = data?.data || {};
  const flags = data?.flags || [];
  const numericSettings = data?.numericSettings || [];

  const toggle = async (key, current, label) => {
    try {
      await superAdminApi.updateSettings({ [key]: !current });
      toast(`${label} turned ${!current ? 'ON' : 'OFF'}`, 'success');
      qc.invalidateQueries({ queryKey: ['system-settings'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Update failed', 'error');
    }
  };

  const saveLimit = async (key, value, label) => {
    try {
      await superAdminApi.updateSettings({ [key]: value });
      toast(`${label} set to ${value === 0 ? 'unlimited' : value}`, 'success');
      qc.invalidateQueries({ queryKey: ['system-settings'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Update failed', 'error');
    }
  };

  if (isLoading) return <p className="text-slate-400">Loading...</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Feature Management</h1>
      <p className="text-sm text-slate-500 mb-6">Turn platform-wide features ON or OFF. Changes take effect immediately.</p>
      <div className="space-y-6 mb-10">
        {flags.map((f) => (
          <ToggleCard
            key={f.key}
            title={f.label}
            description={f.description}
            enabled={!!values[f.key]}
            onToggle={() => toggle(f.key, !!values[f.key], f.label)}
          />
        ))}
      </div>

      {numericSettings.length > 0 && (
        <>
          <h2 className="text-xl font-bold text-slate-800 mb-1">Course Enrollment Limits</h2>
          <p className="text-sm text-slate-500 mb-6">Cap how many open enrollments a student can hold at once. 0 = unlimited.</p>
          <div className="space-y-6">
            {numericSettings.map((n) => (
              <NumericLimitCard
                key={n.key}
                title={n.label}
                description={n.description}
                value={values[n.key] || 0}
                onSave={(v) => saveLimit(n.key, v, n.label)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
