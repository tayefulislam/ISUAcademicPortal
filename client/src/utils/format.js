export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function resolveFileUrl(fileUrl) {
  if (!fileUrl) return '';
  if (fileUrl.startsWith('http')) return fileUrl;
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
  const origin = apiUrl.replace(/\/api\/?$/, '');
  return `${origin}${fileUrl}`;
}

// API path (relative — fetched through the app's own authenticated `api`
// axios instance, never a raw browser fetch) for PdfViewer's client-side
// renderer (pdf.js). Two independent problems this solves by fetching bytes
// ourselves instead of pointing pdf.js at a URL directly:
//   1. CORS — pdf.js's own internal fetch enforces it, and this app's
//      storage buckets (R2/S3) don't send CORS headers (no reason to, since
//      every other use of a file's URL is a plain `<a href>`/`<img>`/
//      download, none of which are CORS-checked) — so a direct storage URL
//      reliably fails there with "blocked by CORS policy".
//   2. Auth — pdf.js's fetch is a plain browser fetch with no knowledge of
//      this app's JWT (unlike every other API call, which goes through the
//      shared `api` axios instance and its Authorization-header
//      interceptor), so a login-required/restricted file's bytes would 403.
// Fetching through `api` (see PdfViewer.jsx) and handing pdf.js the raw
// bytes directly sidesteps both — see fileController.js's streamFilePreview
// for the server side (same access check as the file's own GET endpoint).
export function buildPreviewPath(fileId, attachmentId) {
  return `/files/${fileId}/preview${attachmentId ? `?attachment=${attachmentId}` : ''}`;
}

export function isImageType(fileType) {
  return fileType === 'image';
}

export function isPdfType(fileType) {
  return fileType === 'pdf';
}

// Word/PowerPoint/Excel — rendered via OfficeViewer.jsx (an embedded
// Microsoft/Google document-viewing service), not a client-side library like
// PdfViewer's pdf.js — see that component for why.
const OFFICE_TYPES = new Set(['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx']);
export function isOfficeType(fileType) {
  return OFFICE_TYPES.has(fileType);
}

export const PREVIEWABLE_TYPES = new Set(['pdf', 'image', ...OFFICE_TYPES]);
