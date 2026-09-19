import { useQuery } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { aiCreditApi } from '../api/endpoints.js';
import { formatDate } from '../utils/format.js';

// The AI credit balance, read from the server (never computed here). Non-blocking
// by design: with plenty of credits it is a quiet chip; near the limit it warns
// without stopping anything.
export default function CreditBadge({ className = '' }) {
  const { data } = useQuery({ queryKey: ['ai-credits'], queryFn: aiCreditApi.summary, staleTime: 15_000 });
  const credits = data?.data;
  if (!credits || !credits.creditsEnabled) return null;

  const { balance, monthlyAllocation, usedThisPeriod, nextRechargeAt } = credits;
  const low = balance === 1;
  const none = balance <= 0;

  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border px-4 py-3 mb-5 ${
      none ? 'border-red-200 bg-red-50' : low ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
    } ${className}`}
    >
      <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Sparkles size={15} className={none ? 'text-red-500' : low ? 'text-amber-500' : 'text-brand-600'} />
        AI Application Credits
      </span>
      <span className="text-sm text-slate-700">
        <strong>{balance}</strong> / {monthlyAllocation} remaining
      </span>
      <span className="text-xs text-slate-500">Used this month: {usedThisPeriod}</span>
      {nextRechargeAt && (
        <span className="text-xs text-slate-500">Next recharge: {formatDate(nextRechargeAt)}</span>
      )}
      {balance === 2 && <span className="text-xs text-amber-700">You have 2 AI credits remaining this month.</span>}
      {low && <span className="text-xs text-amber-700">You have 1 AI application credit remaining.</span>}
      {none && (
        <span className="text-xs text-red-700">
          You have used all of your AI application credits this month. You can still edit applications and generate PDF/DOCX.
        </span>
      )}
    </div>
  );
}
