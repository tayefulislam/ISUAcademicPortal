import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Loader2 } from 'lucide-react';
import { notificationApi } from '../api/endpoints.js';
import { enablePush, disablePush, getPermissionState, isPushSupported, needsHomeScreenInstall } from '../utils/push.js';
import { useToast } from '../context/ToastContext.jsx';

const TYPE_LABELS = {
  COURSE_MATERIAL: 'Course Materials',
  FILE_UPLOADED: 'New Files',
  FILE_UPDATED: 'File Updates',
  ASSIGNMENT_CREATED: 'Assignments',
  ASSIGNMENT_UPDATED: 'Assignment Updates',
  ASSIGNMENT_RESULT: 'Assignment Results',
  EXAM_CREATED: 'Exams',
  EXAM_UPDATED: 'Exam Updates',
  EXAM_REMINDER: 'Exam Reminders',
  EXAM_RESULT: 'Exam Results',
  NOTICE_CREATED: 'Notices',
  NOTICE_UPDATED: 'Notice Updates',
  GRADE_PUBLISHED: 'Grades',
  RESULT_PUBLISHED: 'Results',
  MESSAGE_RECEIVED: 'Messages',
  COURSE_ENROLLED: 'Course Enrollment',
  COURSE_UPDATED: 'Course Updates',
  JOIN_REQUEST: 'Join Requests',
  JOIN_REQUEST_APPROVED: 'Join Request Approvals',
  ASSIGNMENT_SUBMITTED: 'New Submissions',
};

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? 'bg-brand-600' : 'bg-slate-300'} ${disabled ? 'opacity-50' : ''}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

export default function NotificationSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pushState, setPushState] = useState(getPermissionState());
  const [pushLoading, setPushLoading] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['notification-preferences'], queryFn: () => notificationApi.getPreferences().then((r) => r.data) });

  const update = useMutation({
    mutationFn: (payload) => notificationApi.updatePreferences(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification-preferences'] }),
    onError: () => toast('Failed to update — try again', 'error'),
  });

  useEffect(() => {
    setPushState(getPermissionState());
  }, [pushLoading]);

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-16 text-slate-400">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }

  const togglePush = async (enabled) => {
    setPushLoading(true);
    if (enabled) {
      const result = await enablePush();
      if (!result.ok) {
        if (result.reason === 'ios-needs-install') toast('Add this app to your Home Screen first, then try again', 'info');
        else if (result.reason === 'denied') toast('Notifications are blocked — enable them in your browser/device settings', 'error');
        else toast('Could not enable push notifications', 'error');
      } else {
        update.mutate({ push: true });
      }
    } else {
      await disablePush();
      update.mutate({ push: false });
    }
    setPushLoading(false);
  };

  const permissionDenied = pushState === 'denied';

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2 mb-1">
        <Bell size={22} className="text-brand-600" /> Notification Settings
      </h1>
      <p className="text-sm text-slate-500 mb-6">Control what you get notified about, and how.</p>

      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-slate-800">Push Notifications</p>
            <p className="text-xs text-slate-500">Receive notifications on this device, even when the app is closed.</p>
            {permissionDenied && (
              <p className="text-xs text-red-600 mt-1">
                Notifications are currently disabled. Enable them from your browser/device settings.
              </p>
            )}
            {needsHomeScreenInstall() && <p className="text-xs text-amber-600 mt-1">Add this app to your Home Screen to enable push on iOS.</p>}
          </div>
          {isPushSupported() ? (
            <Toggle checked={data.push && pushState === 'granted'} onChange={togglePush} disabled={pushLoading || permissionDenied} />
          ) : (
            <span className="text-xs text-slate-400">Not supported</span>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <div>
            <p className="font-medium text-slate-800">Email Notifications</p>
            <p className="text-xs text-slate-500">Also receive a copy of important notifications by email.</p>
          </div>
          <Toggle checked={data.email} onChange={(v) => update.mutate({ email: v })} />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="font-medium text-slate-800 mb-3">Notify me about</p>
        <div className="divide-y divide-slate-100">
          {Object.entries(TYPE_LABELS).map(([type, label]) => (
            <div key={type} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-slate-700">{label}</span>
              <Toggle
                checked={data.types[type] !== false}
                onChange={(v) => update.mutate({ types: { [type]: v } })}
              />
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-slate-400 mt-3">System/security notifications cannot be disabled.</p>
    </div>
  );
}
