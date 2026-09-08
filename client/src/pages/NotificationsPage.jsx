import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCheck, Settings } from 'lucide-react';
import { useNotificationActions } from '../hooks/useNotifications.js';
import NotificationList from '../components/notifications/NotificationList.jsx';

export default function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { markAllRead } = useNotificationActions();

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-slate-800">🔔 Notifications</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => markAllRead.mutate()} className="flex items-center gap-1.5 text-sm text-brand-700 hover:bg-brand-50 px-3 py-1.5 rounded-lg">
            <CheckCheck size={16} /> Mark all read
          </button>
          <Link to="/notifications/settings" className="flex items-center gap-1.5 text-sm text-slate-500 hover:bg-slate-100 px-3 py-1.5 rounded-lg">
            <Settings size={16} /> Settings
          </Link>
        </div>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setUnreadOnly(false)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${!unreadOnly ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
        >
          All
        </button>
        <button
          onClick={() => setUnreadOnly(true)}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${unreadOnly ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}
        >
          Unread
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-2">
        <NotificationList unreadOnly={unreadOnly} />
      </div>
    </div>
  );
}
