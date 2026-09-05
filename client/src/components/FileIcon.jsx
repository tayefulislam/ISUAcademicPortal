import { FileText, Image as ImageIcon, FileSpreadsheet, Presentation, FileArchive, File } from 'lucide-react';

const MAP = {
  pdf: { icon: FileText, color: 'text-red-500 bg-red-50' },
  image: { icon: ImageIcon, color: 'text-purple-500 bg-purple-50' },
  doc: { icon: FileText, color: 'text-blue-500 bg-blue-50' },
  docx: { icon: FileText, color: 'text-blue-500 bg-blue-50' },
  ppt: { icon: Presentation, color: 'text-orange-500 bg-orange-50' },
  pptx: { icon: Presentation, color: 'text-orange-500 bg-orange-50' },
  xls: { icon: FileSpreadsheet, color: 'text-emerald-500 bg-emerald-50' },
  xlsx: { icon: FileSpreadsheet, color: 'text-emerald-500 bg-emerald-50' },
  txt: { icon: FileText, color: 'text-slate-500 bg-slate-100' },
  zip: { icon: FileArchive, color: 'text-amber-500 bg-amber-50' },
  other: { icon: File, color: 'text-slate-500 bg-slate-100' },
};

export default function FileIcon({ type, size = 20, className = '' }) {
  const entry = MAP[type] || MAP.other;
  const Icon = entry.icon;
  return (
    <span className={`inline-flex items-center justify-center rounded-lg p-2 ${entry.color} ${className}`}>
      <Icon size={size} />
    </span>
  );
}
