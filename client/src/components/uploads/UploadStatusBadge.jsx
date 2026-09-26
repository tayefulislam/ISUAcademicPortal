const STYLES = {
  QUEUED: 'bg-slate-100 text-slate-600',
  UPLOADING: 'bg-blue-50 text-blue-700',
  PROCESSING: 'bg-blue-50 text-blue-700',
  VALIDATING: 'bg-indigo-50 text-indigo-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  FAILED: 'bg-red-50 text-red-600',
  CANCELLED: 'bg-slate-100 text-slate-400',
};

// The label is what the user reads while polling, so it says what is happening
// rather than echoing the enum (which is what the server stores).
const LABELS = {
  QUEUED: 'Queued',
  UPLOADING: 'Uploading…',
  PROCESSING: 'Processing…',
  VALIDATING: 'Checking…',
  COMPLETED: 'Ready',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

/** Statuses a client should keep polling for; every other status is terminal. */
export const ACTIVE_STATUSES = new Set(['QUEUED', 'UPLOADING', 'PROCESSING', 'VALIDATING']);

export function isActiveStatus(status) {
  return ACTIVE_STATUSES.has(status);
}

export default function UploadStatusBadge({ status }) {
  const key = STYLES[status] ? status : 'QUEUED';
  return (
    <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-medium ${STYLES[key]}`}>
      {LABELS[key]}
    </span>
  );
}
