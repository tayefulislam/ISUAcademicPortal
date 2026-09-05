import { FolderSearch } from 'lucide-react';

export default function EmptyState({ title = 'No files found', description = 'Try adjusting your filters or search terms.' }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 text-slate-400">
      <FolderSearch size={48} className="mb-3" />
      <p className="font-semibold text-slate-600">{title}</p>
      <p className="text-sm mt-1">{description}</p>
    </div>
  );
}
