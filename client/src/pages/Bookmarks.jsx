import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { bookmarkApi } from '../api/endpoints.js';
import { useDownloadFile } from '../hooks/useDownloadFile.js';
import FileCard from '../components/FileCard.jsx';
import FileGridSkeleton from '../components/FileGridSkeleton.jsx';
import EmptyState from '../components/EmptyState.jsx';

export default function Bookmarks() {
  const [q, setQ] = useState('');
  const [fileType, setFileType] = useState('');
  const download = useDownloadFile();

  const { data, isLoading } = useQuery({ queryKey: ['my-bookmarks'], queryFn: bookmarkApi.list });
  const files = data?.data || [];

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return files.filter((f) => {
      const matchesQ =
        !term ||
        f.title.toLowerCase().includes(term) ||
        f.courseName?.toLowerCase().includes(term) ||
        f.courseId?.toLowerCase().includes(term);
      const matchesType = !fileType || f.fileType === fileType;
      return matchesQ && matchesType;
    });
  }, [files, q, fileType]);

  const fileTypes = useMemo(() => [...new Set(files.map((f) => f.fileType))], [files]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-4">My Bookmarks</h1>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your bookmarks..."
            className="w-full h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-sm"
          />
        </div>
        {fileTypes.length > 1 && (
          <select value={fileType} onChange={(e) => setFileType(e.target.value)} className="h-10 rounded-lg border border-slate-300 px-3 text-sm">
            <option value="">All Types</option>
            {fileTypes.map((t) => (
              <option key={t} value={t}>{t.toUpperCase()}</option>
            ))}
          </select>
        )}
      </div>

      {isLoading ? (
        <FileGridSkeleton />
      ) : filtered.length ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((f) => (
            <FileCard key={f._id} file={f} onDownload={download} />
          ))}
        </div>
      ) : (
        <EmptyState title="No bookmarks yet" description="Files you bookmark will show up here." />
      )}
    </div>
  );
}
