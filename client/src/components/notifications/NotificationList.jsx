import { useMemo } from 'react';
import { Loader2, BellOff } from 'lucide-react';
import { useNotificationList } from '../../hooks/useNotifications.js';
import NotificationItem from './NotificationItem.jsx';

function groupByDay(items) {
  const groups = new Map();
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400000).toDateString();

  for (const item of items) {
    const day = new Date(item.createdAt).toDateString();
    const label = day === today ? 'Today' : day === yesterday ? 'Yesterday' : new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(item);
  }
  return [...groups.entries()];
}

// Reused by both the header dropdown and the full /notifications page —
// spec §14's "Today / Yesterday" grouping.
export default function NotificationList({ unreadOnly = false, onNavigate, compact = false }) {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useNotificationList(unreadOnly);
  const items = useMemo(() => data?.pages.flatMap((p) => p.data) || [], [data]);
  const grouped = useMemo(() => groupByDay(items), [items]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10 text-slate-400">
        <Loader2 className="animate-spin" size={20} />
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-slate-400 gap-2">
        <BellOff size={28} />
        <p className="text-sm">No notifications yet</p>
      </div>
    );
  }

  return (
    <div className={compact ? 'max-h-[70vh] overflow-y-auto' : ''}>
      {grouped.map(([label, dayItems]) => (
        <div key={label} className="mb-2">
          <p className="px-3 py-1 text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
          <div className="space-y-0.5">
            {dayItems.map((n) => (
              <NotificationItem key={n._id} notification={n} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
      {hasNextPage && (
        <button
          onClick={() => fetchNextPage()}
          disabled={isFetchingNextPage}
          className="w-full py-2 text-xs font-medium text-brand-700 hover:bg-brand-50 rounded-lg"
        >
          {isFetchingNextPage ? 'Loading...' : 'Load more'}
        </button>
      )}
    </div>
  );
}
