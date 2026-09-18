const STYLES = {
  QUEUED: 'bg-slate-100 text-slate-600',
  PROCESSING: 'bg-blue-50 text-blue-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  FAILED: 'bg-red-50 text-red-600',
  EXPIRED: 'bg-amber-50 text-amber-700',
  DELETED: 'bg-slate-100 text-slate-400',
};

const LABELS = {
  QUEUED: 'Queued',
  PROCESSING: 'Generating…',
  COMPLETED: 'Ready',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
  DELETED: 'Deleted',
};

/** "3 h left" / "expired" — how long the signed download stays available. */
export function expiryLabel(expiresAt) {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours} h left` : `${Math.round(hours / 24)} d left`;
}

export default function DocumentStatusBadge({ status, expired = false }) {
  const key = expired && status === 'COMPLETED' ? 'EXPIRED' : status;
  return (
    <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${STYLES[key] || STYLES.QUEUED}`}>
      {LABELS[key] || key}
    </span>
  );
}
