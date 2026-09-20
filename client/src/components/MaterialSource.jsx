import { HardDrive, Link2 } from 'lucide-react';

// Shared "how are you submitting this material?" control used by all three
// upload forms (student Submit Material, Admin upload, Faculty upload). A
// material is either an uploaded file (`file`) or an external HTTPS link
// (`external`) — the choice and the URL are the only things that differ between
// the forms, so they live here rather than being repeated three times.

export const UPLOAD_TYPE_FILE = 'file';
export const UPLOAD_TYPE_EXTERNAL = 'external';

/** Client-side mirror of the server's HTTPS check (utils/externalUrl.js). */
export function isValidHttpsUrl(value) {
  if (!value || typeof value !== 'string') return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export function UploadTypeToggle({ value, onChange }) {
  const tab = (key, label, Icon) => (
    <button
      type="button"
      onClick={() => onChange(key)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${
        value === key ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'
      }`}
    >
      <Icon size={15} /> {label}
    </button>
  );

  return (
    <div className="flex gap-2 p-1 bg-slate-100 rounded-lg w-fit">
      {tab(UPLOAD_TYPE_FILE, 'File upload', HardDrive)}
      {tab(UPLOAD_TYPE_EXTERNAL, 'External link', Link2)}
    </div>
  );
}

export function ExternalUrlField({ value, onChange }) {
  const valid = isValidHttpsUrl(value);
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        External link <span className="text-red-500">*</span>
      </label>
      <input
        type="url"
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://drive.google.com/…"
        className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm"
      />
      {value && !valid && (
        <p className="text-xs text-red-500 mt-1">Enter a valid https:// link.</p>
      )}
      <p className="text-xs text-slate-400 mt-1">
        Google Drive, OneDrive, Dropbox, or any other https:// document link. Use this for files larger
        than the 10 MB upload limit.
      </p>
    </div>
  );
}
