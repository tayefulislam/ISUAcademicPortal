import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Paperclip, Megaphone } from 'lucide-react';
import { noticeApi } from '../api/endpoints.js';
import { formatDate } from '../utils/format.js';
import { trackClarityEvent } from '../analytics/clarity.js';

const PRIORITY_STYLE = {
  low: 'bg-slate-100 text-slate-600',
  normal: 'bg-brand-50 text-brand-700',
  high: 'bg-amber-50 text-amber-700',
  urgent: 'bg-red-50 text-red-600',
};

export default function Notices() {
  const { data, isLoading } = useQuery({ queryKey: ['notices'], queryFn: noticeApi.list });
  const notices = data?.data || [];

  useEffect(() => {
    trackClarityEvent('notices_viewed');
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-2 mb-1">
        <Megaphone className="text-brand-600" size={22} />
        <h1 className="text-2xl font-bold text-slate-800">Notices & Announcements</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">Updates relevant to you — department, course, batch, and semester notices, plus general announcements.</p>

      {isLoading ? (
        <p className="text-slate-400">Loading...</p>
      ) : notices.length === 0 ? (
        <p className="text-slate-400">No notices right now.</p>
      ) : (
        <div className="space-y-3">
          {notices.map((n) => (
            <div key={n._id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-slate-700">{n.title}</p>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_STYLE[n.priority]}`}>{n.priority}</span>
              </div>
              <p className="text-sm text-slate-600 mt-1">{n.description}</p>
              {n.attachmentUrl && (
                <a href={n.attachmentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline mt-2">
                  <Paperclip size={12} /> {n.attachmentName || 'Attachment'}
                </a>
              )}
              <p className="text-xs text-slate-400 mt-2">Published {formatDate(n.publishDate)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
