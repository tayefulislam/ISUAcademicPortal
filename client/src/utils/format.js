export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  // The units run to TB because the storage dashboard reports institution-wide
  // totals, which reach that scale — without it, a terabyte total rendered as
  // "2.8 undefined".
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Exact date+time in Bangladesh Standard Time (UTC+6, no DST) — deliberately
// fixed to this one timezone rather than the viewer's own (unlike
// formatDate/formatTime above), for exam start/end times: every student is
// in the same institution, so an absolute time stated in the institution's
// own timezone is unambiguous, where "your local time" would silently shift
// per viewer and no longer match what a countdown next to it is counting
// down to.
export function formatBST(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const datePart = d.toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', year: 'numeric', month: 'short', day: 'numeric' });
  const timePart = d.toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${timePart} BST`;
}

// Bangladesh has a fixed +06:00 offset year-round (no DST), so converting a
// UTC instant to/from Dhaka wall-clock components is just +/- 6 hours of
// epoch time — no timezone-database library needed. These two are the
// write/edit-side counterpart to formatBST's read-only display: they let a
// `<input type="datetime-local">` (which only ever holds a bare, offset-less
// "YYYY-MM-DDTHH:mm" string, always meant here as Bangladesh time — see
// QuizManager.jsx) round-trip correctly against the API's UTC ISO strings.
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

// UTC ISO string (from the API) -> "YYYY-MM-DDTHH:mm" Dhaka wall-clock, for
// hydrating a datetime-local input when editing an existing quiz.
export function toDhakaInputValue(isoString) {
  if (!isoString) return '';
  const utc = new Date(isoString);
  if (Number.isNaN(utc.getTime())) return '';
  return new Date(utc.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 16);
}

// A datetime-local input's bare "YYYY-MM-DDTHH:mm" value (always meant as
// Bangladesh local time) -> an explicit UTC ISO string, so the payload sent
// to the API is unambiguous even without relying on the backend's own
// naive-string-means-Dhaka fallback (server/src/utils/timezone.js).
export function dhakaInputToIso(inputValue) {
  if (!inputValue) return '';
  const withSeconds = inputValue.length === 16 ? `${inputValue}:00` : inputValue;
  const d = new Date(`${withSeconds}+06:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
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
