import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { enablePush, getPermissionState, isPushSupported, needsHomeScreenInstall } from '../../utils/push.js';

const DISMISS_KEY = 'notif-prompt-dismissed';

// Spec §11: never ask for permission on first load, never re-prompt after a
// hard "denied", and never re-prompt after "Maybe Later" either — dismissal
// is remembered per-device (localStorage), independent of the actual
// browser permission state.
export default function EnableNotificationPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isPushSupported()) return;
    if (localStorage.getItem(DISMISS_KEY) === 'true') return;
    if (getPermissionState() !== 'default') return; // already granted or denied — nothing to ask
    const timer = setTimeout(() => setVisible(true), 4000); // let the app load first
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, 'true');
    setVisible(false);
  };

  const enable = async () => {
    const result = await enablePush();
    localStorage.setItem(DISMISS_KEY, 'true');
    setVisible(false);
    if (!result.ok && result.reason === 'ios-needs-install') {
      alert('To enable notifications on iPhone/iPad, first add this app to your Home Screen, then open it from there and try again.');
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[100] w-80 max-w-[90vw] bg-white rounded-xl shadow-xl border border-slate-200 p-4">
      <div className="flex items-start justify-between mb-2">
        <p className="font-semibold text-slate-800 flex items-center gap-1.5">
          <Bell size={18} className="text-brand-600" /> Stay Updated
        </p>
        <button onClick={dismiss} className="text-slate-400 hover:text-slate-600" aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-2">Enable notifications to receive:</p>
      <ul className="text-sm text-slate-600 space-y-1 mb-3">
        <li>✓ New course materials</li>
        <li>✓ Assignment updates</li>
        <li>✓ Exam reminders</li>
        <li>✓ Results</li>
        <li>✓ Important notices</li>
        <li>✓ Messages</li>
      </ul>
      {needsHomeScreenInstall() && (
        <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-2 py-1.5 mb-2">
          On iPhone/iPad: add this app to your Home Screen first (Share → Add to Home Screen), then open it from there.
        </p>
      )}
      <div className="flex gap-2">
        <button onClick={enable} className="flex-1 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700">
          Enable Notifications
        </button>
        <button onClick={dismiss} className="px-3 py-2 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100">
          Maybe Later
        </button>
      </div>
    </div>
  );
}
