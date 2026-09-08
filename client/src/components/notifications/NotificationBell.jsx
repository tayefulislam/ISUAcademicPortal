import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useUnreadCount } from '../../hooks/useNotifications.js';
import NotificationDropdown from './NotificationDropdown.jsx';

// Dropped into every authenticated top nav (Navbar for students/public,
// DashboardShell's header for Faculty/Admin/Super Admin) — one component,
// same behavior everywhere.
export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { data: count = 0 } = useUnreadCount();

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative p-2 rounded-lg text-slate-500 hover:text-brand-700 hover:bg-slate-100"
        aria-label="Notifications"
      >
        <Bell size={20} />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-[10px] font-bold leading-none">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && <NotificationDropdown onClose={() => setOpen(false)} />}
    </div>
  );
}
