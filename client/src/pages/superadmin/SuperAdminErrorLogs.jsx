import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, AlertCircle, Trash2, X, Search } from 'lucide-react';
import { superAdminApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import Pagination from '../../components/Pagination.jsx';
import { formatDate, formatTime } from '../../utils/format.js';

const LEVEL_STYLE = {
  error: 'bg-red-50 text-red-700',
  warn: 'bg-amber-50 text-amber-700',
  info: 'bg-slate-100 text-slate-600',
};
const LEVEL_ICON = { error: AlertCircle, warn: AlertTriangle, info: Info };

export default function SuperAdminErrorLogs() {
  const [level, setLevel] = useState('error');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [page, setPage] = useState(1);
  const [viewing, setViewing] = useState(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const params = { level: level || undefined, q: debouncedQ || undefined, page, limit: 20 };
  const { data, isLoading } = useQuery({
    queryKey: ['super-admin-logs', params],
    queryFn: () => superAdminApi.listLogs(params),
  });

  const logs = data?.data || [];
  const counts = data?.counts || {};
  const totalAll = (counts.error || 0) + (counts.warn || 0) + (counts.info || 0);

  const removeLog = async (id) => {
    if (!confirm('Delete this log entry?')) return;
    try {
      await superAdminApi.deleteLog(id);
      toast('Log deleted', 'success');
      qc.invalidateQueries({ queryKey: ['super-admin-logs'] });
      setViewing(null);
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to delete log', 'error');
    }
  };

  const clearAll = async () => {
    const label = level ? `all "${level}" logs` : 'ALL logs';
    if (!confirm(`Clear ${label}? This cannot be undone.`)) return;
    try {
      const res = await superAdminApi.clearLogs(level || undefined);
      toast(res.message || 'Logs cleared', 'success');
      qc.invalidateQueries({ queryKey: ['super-admin-logs'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to clear logs', 'error');
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Error &amp; System Logs</h1>
          <p className="text-sm text-slate-500 mt-0.5">Every server error, warning, and system event — where and when it happened.</p>
        </div>
        <button
          onClick={clearAll}
          className="flex items-center gap-1.5 h-10 px-4 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50"
        >
          <Trash2 size={16} /> Clear {level || 'All'}
        </button>
      </div>

      <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-lg w-fit mb-4">
        {[
          { key: '', label: `All (${totalAll})` },
          { key: 'error', label: `Errors (${counts.error || 0})` },
          { key: 'warn', label: `Warnings (${counts.warn || 0})` },
          { key: 'info', label: `Info (${counts.info || 0})` },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => { setLevel(t.key); setPage(1); }}
            className={`px-3 py-1.5 rounded-md text-sm font-medium ${
              level === t.key ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="relative mb-4 max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Search by message..."
          className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-sm"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="p-3 text-left">Level</th>
              <th className="p-3 text-left">Message</th>
              <th className="p-3 text-left">Source</th>
              <th className="p-3 text-left">Route</th>
              <th className="p-3 text-left">User</th>
              <th className="p-3 text-left">When</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="p-6 text-center text-slate-400">Loading...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={7} className="p-6 text-center text-slate-400">No logs found.</td></tr>
            ) : (
              logs.map((log) => {
                const Icon = LEVEL_ICON[log.level] || Info;
                return (
                  <tr key={log._id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setViewing(log)}>
                    <td className="p-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${LEVEL_STYLE[log.level] || LEVEL_STYLE.info}`}>
                        <Icon size={12} /> {log.level}
                      </span>
                    </td>
                    <td className="p-3 max-w-sm truncate text-slate-700" title={log.message}>{log.message}</td>
                    <td className="p-3 text-slate-500 font-mono text-xs">{log.source || '-'}</td>
                    <td className="p-3 text-slate-500 text-xs">{log.method ? `${log.method} ${log.url}` : '-'}</td>
                    <td className="p-3 text-slate-500 text-xs">{log.userId?.email || log.ip || '-'}</td>
                    <td className="p-3 text-slate-400 text-xs">{formatDate(log.createdAt)} {formatTime(log.createdAt)}</td>
                    <td className="p-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); removeLog(log._id); }}
                        title="Delete"
                        className="p-1.5 rounded hover:bg-slate-100 text-red-500"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {data?.pagination && <Pagination page={page} pages={data.pagination.pages} onChange={setPage} />}

      {viewing && <LogDetailModal log={viewing} onClose={() => setViewing(null)} onDelete={() => removeLog(viewing._id)} />}
    </div>
  );
}

function LogDetailModal({ log, onClose, onDelete }) {
  const Icon = LEVEL_ICON[log.level] || Info;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-2xl w-full p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${LEVEL_STYLE[log.level] || LEVEL_STYLE.info}`}>
              <Icon size={12} /> {log.level}
            </span>
            <h2 className="text-lg font-bold text-slate-800 mt-2 break-words">{log.message}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
          <Detail label="Source" value={log.source || '-'} />
          <Detail label="Status Code" value={log.statusCode || '-'} />
          <Detail label="Route" value={log.method ? `${log.method} ${log.url}` : '-'} />
          <Detail label="IP" value={log.ip || '-'} />
          <Detail label="User" value={log.userId ? `${log.userId.name} (${log.userId.email})` : '-'} />
          <Detail label="When" value={`${formatDate(log.createdAt)} ${formatTime(log.createdAt)}`} />
          <div className="col-span-2">
            <Detail label="User Agent" value={log.userAgent || '-'} />
          </div>
        </div>

        {log.stack && (
          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Stack Trace</p>
            <pre className="bg-slate-900 text-slate-100 text-xs p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-words">{log.stack}</pre>
          </div>
        )}

        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50"
        >
          <Trash2 size={15} /> Delete this log
        </button>
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-slate-400 text-xs uppercase font-medium">{label}</p>
      <p className="text-slate-700 break-words">{value}</p>
    </div>
  );
}
