import { useNavigate } from 'react-router-dom';
import { Bell, FileText, ClipboardList, GraduationCap, Trophy, Megaphone, MessageCircle, Trash2, Clock, CalendarClock, CalendarX, MapPin } from 'lucide-react';
import { useNotificationActions } from '../../hooks/useNotifications.js';

const ICONS = {
  FILE_UPLOADED: FileText,
  FILE_UPDATED: FileText,
  COURSE_MATERIAL: FileText,
  ASSIGNMENT_CREATED: ClipboardList,
  ASSIGNMENT_UPDATED: ClipboardList,
  ASSIGNMENT_SUBMITTED: ClipboardList,
  ASSIGNMENT_RESULT: Trophy,
  EXAM_CREATED: GraduationCap,
  EXAM_UPDATED: GraduationCap,
  EXAM_REMINDER: GraduationCap,
  EXAM_RESULT: Trophy,
  // Class routine — each reminder offset is its own type on the server, so the
  // icon has to distinguish "starting soon" from "cancelled" without relying on
  // colour alone.
  CLASS_REMINDER: Clock,
  CLASS_STARTING: Clock,
  CLASS_CANCELLED: CalendarX,
  CLASS_RESCHEDULED: CalendarClock,
  CLASS_ROOM_CHANGED: MapPin,
  NOTICE_CREATED: Megaphone,
  NOTICE_UPDATED: Megaphone,
  GRADE_PUBLISHED: Trophy,
  RESULT_PUBLISHED: Trophy,
  MESSAGE_RECEIVED: MessageCircle,
};

function timeAgo(date) {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function NotificationItem({ notification, onNavigate }) {
  const navigate = useNavigate();
  const { markRead, remove } = useNotificationActions();
  const Icon = ICONS[notification.type] || Bell;

  const handleClick = () => {
    if (!notification.isRead) markRead.mutate(notification._id);
    if (notification.url) navigate(notification.url);
    onNavigate?.();
  };

  return (
    <div
      className={`group flex items-start gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
        notification.isRead ? 'hover:bg-slate-50' : 'bg-brand-50 hover:bg-brand-100'
      }`}
      onClick={handleClick}
    >
      <div className={`shrink-0 mt-0.5 p-1.5 rounded-full ${notification.isRead ? 'bg-slate-100 text-slate-500' : 'bg-brand-100 text-brand-700'}`}>
        <Icon size={14} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-sm truncate ${notification.isRead ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>{notification.title}</p>
        <p className="text-xs text-slate-500 truncate">{notification.message}</p>
        <p className="text-[11px] text-slate-400 mt-0.5">{timeAgo(notification.createdAt)}</p>
      </div>
      {!notification.isRead && <span className="shrink-0 mt-1.5 w-2 h-2 rounded-full bg-brand-600" />}
      <button
        onClick={(e) => {
          e.stopPropagation();
          remove.mutate(notification._id);
        }}
        className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
        aria-label="Delete notification"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
