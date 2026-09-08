import { Link } from 'react-router-dom';
import { CheckCheck, Settings } from 'lucide-react';
import { useNotificationActions } from '../../hooks/useNotifications.js';
import NotificationList from './NotificationList.jsx';

export default function NotificationDropdown({ onClose }) {
  const { markAllRead } = useNotificationActions();

  return (
    <div className="absolute right-0 mt-2 w-[22rem] max-w-[90vw] bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-100">
        <p className="font-semibold text-slate-800 text-sm">🔔 Notifications</p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => markAllRead.mutate()}
            className="p-1.5 rounded-lg text-slate-400 hover:text-brand-700 hover:bg-brand-50"
            title="Mark all as read"
          >
            <CheckCheck size={16} />
          </button>
          <Link to="/notifications/settings" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-brand-700 hover:bg-brand-50" title="Settings">
            <Settings size={16} />
          </Link>
        </div>
      </div>

      <div className="p-2">
        <NotificationList compact onNavigate={onClose} />
      </div>

      <Link
        to="/notifications"
        onClick={onClose}
        className="block text-center text-sm font-medium text-brand-700 py-2.5 border-t border-slate-100 hover:bg-brand-50"
      >
        View all notifications
      </Link>
    </div>
  );
}
