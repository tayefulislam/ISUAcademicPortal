import { useQuery } from '@tanstack/react-query';
import { Files, HardDrive, Database, TrendingDown, Sparkles, Server, Loader2, AlertTriangle } from 'lucide-react';
import { storageAdminApi } from '../../api/endpoints.js';
import StatCard from '../../components/StatCard.jsx';
import { formatBytes } from '../../utils/format.js';

/**
 * The storage dashboard (§24).
 *
 * Every figure here is derived from `StoredFile` rows — the aggregate endpoint
 * computes the totals in MongoDB rather than making the browser sum a page of
 * results, so the numbers stay correct as the collection grows past one page.
 *
 * The reduction percentage is WEIGHTED (total saved ÷ total original), not an
 * average of per-file percentages: a 4 KB file must not count as much as a 1 GB
 * one when reporting the overall effect.
 */

const CATEGORY_ORDER = ['image', 'document', 'archive', 'video', 'audio', 'other'];
const CATEGORY_LABELS = {
  image: 'Images',
  document: 'Documents',
  archive: 'Archives',
  video: 'Video',
  audio: 'Audio',
  other: 'Other',
};

const QUEUE_ORDER = ['uploading', 'queued', 'processing', 'validating', 'completed', 'failed', 'cancelled'];
const QUEUE_LABELS = {
  queued: 'Queued',
  uploading: 'Uploading',
  processing: 'Processing',
  validating: 'Validating',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};
const QUEUE_STYLE = {
  queued: 'bg-slate-100 text-slate-600',
  uploading: 'bg-blue-50 text-blue-700',
  processing: 'bg-blue-50 text-blue-700',
  validating: 'bg-indigo-50 text-indigo-700',
  completed: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-600',
  cancelled: 'bg-slate-100 text-slate-400',
};

function Panel({ title, subtitle, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <h2 className="font-semibold text-slate-700">{title}</h2>
      {subtitle && <p className="text-xs text-slate-400 mt-0.5 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-3" />}
      {children}
    </div>
  );
}

/**
 * Original vs stored, as a bar. Visually answers the only question the dashboard
 * exists to answer: how much of what we were given are we actually paying for?
 */
function ReductionBar({ original, stored, reduction }) {
  const storedPct = original > 0 ? Math.max(2, Math.round((stored / original) * 100)) : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-2">
        <span className="text-slate-500">
          Original data <span className="font-semibold text-slate-700">{formatBytes(original)}</span>
        </span>
        <span className="text-slate-500">
          Actual storage <span className="font-semibold text-slate-700">{formatBytes(stored)}</span>
        </span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden" title={`${reduction}% smaller`}>
        <div className="bg-brand-600 h-3 rounded-full transition-all" style={{ width: `${storedPct}%` }} />
      </div>
      <p className="text-xs text-slate-400 mt-2">
        {reduction > 0
          ? `${reduction}% of the original data is not being stored.`
          : 'Nothing has been optimized yet.'}
      </p>
    </div>
  );
}

export default function SuperAdminStorage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['storage-dashboard'],
    queryFn: storageAdminApi.dashboard,
    // Keep refreshing while work is in flight, so the queue panel is live;
    // stop entirely once nothing is active (an idle dashboard makes no requests).
    refetchInterval: (query) => (query.state.data?.data?.queue?.active > 0 ? 4000 : false),
  });

  const d = data?.data;

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 text-slate-400">
        <Loader2 size={16} className="animate-spin" /> Loading storage statistics…
      </p>
    );
  }

  if (isError || !d) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="flex items-center gap-2 text-red-600 font-medium">
          <AlertTriangle size={18} /> Could not load the storage dashboard.
        </p>
        <p className="text-sm text-slate-500 mt-1">{error?.response?.data?.message || 'Please try again.'}</p>
      </div>
    );
  }

  const categoryRows = CATEGORY_ORDER.filter((k) => d.byCategory?.[k]).map((k) => ({ key: k, ...d.byCategory[k] }));
  const extraCategories = Object.keys(d.byCategory || {}).filter((k) => !CATEGORY_ORDER.includes(k));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Storage</h1>
        <p className="text-sm text-slate-500 mt-1">
          What has been uploaded through the optimization pipeline, and how much of it is actually being stored.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Total Files" value={d.totalFiles} icon={Files} />
        <StatCard label="Original Data" value={formatBytes(d.totalOriginalSize)} icon={Database} />
        <StatCard label="Actual Storage" value={formatBytes(d.totalStoredSize)} icon={HardDrive} />
        <StatCard label="Saved" value={formatBytes(d.totalSavedBytes)} icon={TrendingDown} />
        <StatCard label="Storage Reduction" value={`${d.storageReduction}%`} icon={TrendingDown} />
        <StatCard label="Optimized Files" value={d.optimizedFiles} icon={Sparkles} />
      </div>

      <Panel
        title="Original vs stored"
        subtitle="An optimized version only replaces the original when the saving clears both a byte floor and a percentage floor."
      >
        <ReductionBar original={d.totalOriginalSize} stored={d.totalStoredSize} reduction={d.storageReduction} />
      </Panel>

      <Panel title="By file type" subtitle="Where the original bytes came from, and what was kept.">
        {categoryRows.length === 0 && extraCategories.length === 0 ? (
          <p className="text-sm text-slate-400">No files have been uploaded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="p-3 text-left">Type</th>
                  <th className="p-3 text-right">Files</th>
                  <th className="p-3 text-right">Original</th>
                  <th className="p-3 text-right">Stored</th>
                  <th className="p-3 text-right">Saved</th>
                  <th className="p-3 text-right">Reduction</th>
                </tr>
              </thead>
              <tbody>
                {[...categoryRows, ...extraCategories.map((k) => ({ key: k, ...d.byCategory[k] }))].map((row) => (
                  <tr key={row.key} className="border-t border-slate-100">
                    <td className="p-3 font-medium text-slate-700">{CATEGORY_LABELS[row.key] || row.key}</td>
                    <td className="p-3 text-right text-slate-600">{row.files}</td>
                    <td className="p-3 text-right text-slate-600">{formatBytes(row.originalSize)}</td>
                    <td className="p-3 text-right text-slate-600">{formatBytes(row.storedSize)}</td>
                    <td className="p-3 text-right text-emerald-600">{formatBytes(row.savedBytes)}</td>
                    <td className="p-3 text-right text-slate-600">{row.savedPercentage}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid md:grid-cols-2 gap-6">
        <Panel title="Processing queue" subtitle="Live while anything is in flight.">
          <div className="flex flex-wrap gap-2">
            {QUEUE_ORDER.map((key) => (
              <span
                key={key}
                className={`px-2.5 py-1 rounded-full text-xs font-medium ${QUEUE_STYLE[key]}`}
              >
                {QUEUE_LABELS[key]}: {d.queue?.[key] ?? 0}
              </span>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-3">
            {d.queue?.active > 0
              ? `${d.queue.active} job(s) in flight — this panel refreshes automatically.`
              : 'Nothing is being processed right now.'}
          </p>
          {(d.queue?.failed ?? 0) > 0 && (
            <p className="flex items-center gap-1.5 text-xs text-red-600 mt-2">
              <AlertTriangle size={13} />
              {d.queue.failed} file(s) could not be optimized. The originals are still available to download.
            </p>
          )}
        </Panel>

        <Panel title="Storage providers" subtitle="Which backend is holding the bytes.">
          {Object.keys(d.byProvider || {}).length === 0 ? (
            <p className="text-sm text-slate-400">No data yet.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(d.byProvider || {}).map(([provider, info]) => (
                <div
                  key={provider}
                  className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100 last:border-0"
                >
                  <span className="flex items-center gap-2 font-medium text-slate-700">
                    <Server size={14} className="text-slate-400" />
                    {provider}
                  </span>
                  <span className="text-xs text-slate-400">
                    {info.files} file(s) · {formatBytes(info.storedSize)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {d.totalFiles === 0 && (
        <p className="text-sm text-slate-400">
          Nothing has been recorded yet. Material uploaded through Upload Material or Submit Material is counted here
          as well, once it has been through the pipeline.
        </p>
      )}
    </div>
  );
}
