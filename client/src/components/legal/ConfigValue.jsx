import { AlertTriangle, Mail, Phone, MapPin } from 'lucide-react';
import { isPlaceholder } from '../../config/site.js';

// Renders a value from src/config/site.js. When the value is still the shipped
// placeholder, it is shown as a clearly-marked, hard-to-miss "CONFIG
// PLACEHOLDER" chip instead of a fake address/phone — so the page is honest
// about what the university still has to supply, and the value is trivially
// replaceable in one file.

const ICONS = { mail: Mail, phone: Phone, address: MapPin };

export default function ConfigValue({ field, kind = 'mail', mono = false }) {
  if (!field) return null;

  if (isPlaceholder(field)) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 align-middle">
        <AlertTriangle size={12} className="shrink-0" />
        {field.value}
      </span>
    );
  }

  const Icon = ICONS[kind];

  if (kind === 'mail') {
    return (
      <a
        href={`mailto:${field.value}`}
        className="inline-flex items-center gap-1.5 text-brand-700 font-medium hover:underline break-all"
      >
        {Icon && <Icon size={14} className="shrink-0" />}
        {field.value}
      </a>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-slate-800 ${mono ? 'font-mono text-sm' : ''}`}>
      {Icon && <Icon size={14} className="shrink-0 text-slate-500" />}
      <span className="break-words">{field.value}</span>
    </span>
  );
}
