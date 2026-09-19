import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { applicationAdminApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/format.js';

// Super Admin / admin-tier: the AI credit ledger. Every manual change writes an
// ADMIN_ADJUSTMENT transaction on the server, so a balance can always be
// explained — there is no silent edit here.
export default function AiCredits() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [historyFor, setHistoryFor] = useState(null);

  const { data } = useQuery({
    queryKey: ['admin-ai-credits', search],
    queryFn: () => applicationAdminApi.listCredits({ search: search || undefined, limit: 50 }),
  });
  const accounts = data?.data || [];

  const { data: historyData } = useQuery({
    queryKey: ['admin-ai-credit-history', historyFor?.userId],
    queryFn: () => applicationAdminApi.creditHistory(historyFor.userId, 50),
    enabled: Boolean(historyFor),
  });

  const adjust = async (account) => {
    const raw = window.prompt(`Adjust credits for ${account.name || account.email}. Use a negative number to remove.`, '1');
    if (!raw) return;
    const amount = Number(raw);
    if (!Number.isInteger(amount) || amount === 0) return toast('Enter a whole, non-zero number', 'error');
    try {
      await applicationAdminApi.adjustCredits(account.userId, { amount, description: 'Manual admin adjustment' });
      toast('Credits adjusted', 'success');
      qc.invalidateQueries({ queryKey: ['admin-ai-credits', search] });
    } catch (err) {
      toast(err.response?.data?.message || 'Could not adjust credits', 'error');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-xl font-bold text-slate-800 mb-1">AI Application Credits</h1>
      <p className="text-sm text-slate-500 mb-5">Balances, monthly usage and manual adjustments. Every change is audited.</p>

      <div className="relative mb-4 max-w-sm">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="input pl-9"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3">User</th>
              <th className="text-right px-4 py-3">Balance</th>
              <th className="text-right px-4 py-3">Monthly</th>
              <th className="text-right px-4 py-3">Used</th>
              <th className="text-left px-4 py-3">Next recharge</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {accounts.map((account) => (
              <tr key={account.userId}>
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-700">{account.name || '—'}</p>
                  <p className="text-xs text-slate-400">{account.email} {account.role ? `· ${account.role}` : ''}</p>
                </td>
                <td className="px-4 py-3 text-right font-semibold text-slate-700">{account.balance}</td>
                <td className="px-4 py-3 text-right text-slate-500">{account.monthlyAllocation}</td>
                <td className="px-4 py-3 text-right text-slate-500">{account.usedThisPeriod}</td>
                <td className="px-4 py-3 text-slate-500">{account.nextRechargeAt ? formatDate(account.nextRechargeAt) : '—'}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => setHistoryFor(account)} className="text-xs font-semibold text-slate-500 hover:underline mr-3">History</button>
                  <button onClick={() => adjust(account)} className="text-xs font-semibold text-brand-600 hover:underline">Adjust</button>
                </td>
              </tr>
            ))}
            {accounts.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No credit accounts yet — a balance is created the first time someone uses AI.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {historyFor && (
        <div className="mt-5 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-700">History — {historyFor.name || historyFor.email}</h2>
            <button onClick={() => setHistoryFor(null)} className="text-xs text-slate-500 hover:underline">Close</button>
          </div>
          <div className="space-y-1 text-sm">
            {(historyData?.data || []).map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3">
                <span className="text-slate-600">{row.type} <span className="text-slate-400">{row.status}</span></span>
                <span className={row.amount >= 0 ? 'text-emerald-700' : 'text-red-600'}>
                  {row.amount >= 0 ? '+' : ''}{row.amount}
                </span>
                <span className="text-xs text-slate-400 w-40 text-right">{row.balanceBefore} → {row.balanceAfter}</span>
                <span className="text-xs text-slate-400 w-40 text-right">{formatDate(row.createdAt)}</span>
              </div>
            ))}
            {(historyData?.data || []).length === 0 && <p className="text-slate-400 text-sm">No transactions.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
