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

export function isImageType(fileType) {
  return fileType === 'image';
}

export function isPdfType(fileType) {
  return fileType === 'pdf';
}

export const PREVIEWABLE_TYPES = new Set(['pdf', 'image']);
