import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Trash2, Eye, Download, Search } from 'lucide-react';
import { fileApi } from '../../api/endpoints.js';
import { formatBytes, formatDate } from '../../utils/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import Pagination from '../../components/Pagination.jsx';

export default function AdminFiles() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin-files', q, page],
    queryFn: () => fileApi.list({ q: q || undefined, page, limit: 15, sort: 'newest' }),
  });

  const files = data?.data || [];
  const allSelected = files.length > 0 && selected.length === files.length;

  const toggleAll = () => setSelected(allSelected ? [] : files.map((f) => f._id));
  const toggleOne = (id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const deleteOne = async (id) => {
    if (!confirm('Delete this file permanently? This cannot be undone.')) return;
    try {
      await fileApi.remove(id);
      toast('File deleted', 'success');
      qc.invalidateQueries({ queryKey: ['admin-files'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed', 'error');
    }
  };

  const bulkDelete = async () => {
    if (!selected.length) return;
    if (!confirm(`Delete ${selected.length} selected file(s) permanently?`)) return;
    try {
      await fileApi.bulkRemove(selected);
      toast(`${selected.length} file(s) deleted`, 'success');
      setSelected([]);
      qc.invalidateQueries({ queryKey: ['admin-files'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Bulk delete failed', 'error');
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-slate-800">Manage Files</h1>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search files..."
            className="h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-sm w-64"
          />
        </div>
      </div>

      {selected.length > 0 && (
        <div className="mb-3 flex items-center justify-between bg-brand-50 border border-brand-200 rounded-lg px-4 py-2 text-sm">
          <span>{selected.length} selected</span>
          <button onClick={bulkDelete} className="flex items-center gap-1.5 text-red-600 font-medium hover:underline">
            <Trash2 size={14} /> Delete selected
          </button>
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="p-3 w-8">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th className="p-3 text-left">File</th>
              <th className="p-3 text-left">Department</th>
              <th className="p-3 text-left">Course</th>
              <th className="p-3 text-left">Category</th>
              <th className="p-3 text-left">Uploaded</th>
              <th className="p-3 text-left">Views</th>
              <th className="p-3 text-left">Downloads</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={9} className="p-6 text-center text-slate-400">Loading...</td></tr>
            ) : files.length === 0 ? (
              <tr><td colSpan={9} className="p-6 text-center text-slate-400">No files found.</td></tr>
            ) : (
              files.map((f) => (
                <tr key={f._id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3"><input type="checkbox" checked={selected.includes(f._id)} onChange={() => toggleOne(f._id)} /></td>
                  <td className="p-3 max-w-[220px]">
                    <p className="font-medium text-slate-700 truncate">
                      {f.title} {f.fileCount > 1 && <span className="text-brand-600 font-normal">({f.fileCount} files)</span>}
                    </p>
                    <p className="text-xs text-slate-400">{f.fileType.toUpperCase()} &middot; {formatBytes(f.fileSize)}</p>
                  </td>
                  <td className="p-3">{f.departmentCode}</td>
                  <td className="p-3">{f.courseId}</td>
                  <td className="p-3">{f.categoryName}</td>
                  <td className="p-3">{formatDate(f.createdAt)}</td>
                  <td className="p-3">{f.views}</td>
                  <td className="p-3">{f.downloads}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <Link to={`/files/${f._id}`} className="p-1.5 rounded hover:bg-slate-100" title="View">
                        <Eye size={16} />
                      </Link>
                      <a href={f.fileUrl} className="p-1.5 rounded hover:bg-slate-100" title="Download">
                        <Download size={16} />
                      </a>
                      <button onClick={() => deleteOne(f._id)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Delete">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden space-y-3">
        {files.map((f) => (
          <div key={f._id} className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-slate-700 truncate">{f.title}</p>
                <p className="text-xs text-slate-400 mt-0.5">{f.departmentCode} &middot; {f.courseId} &middot; {f.categoryName}</p>
              </div>
              <input type="checkbox" checked={selected.includes(f._id)} onChange={() => toggleOne(f._id)} />
            </div>
            <div className="flex items-center justify-between mt-3 text-xs text-slate-400">
              <span>{formatDate(f.createdAt)}</span>
              <span>{f.views} views &middot; {f.downloads} downloads</span>
            </div>
            <div className="flex gap-2 mt-3">
              <Link to={`/files/${f._id}`} className="flex-1 text-center py-1.5 rounded-md border border-slate-300 text-sm">View</Link>
              <button onClick={() => deleteOne(f._id)} className="flex-1 text-center py-1.5 rounded-md border border-red-200 text-red-600 text-sm">Delete</button>
            </div>
          </div>
        ))}
      </div>

      {data?.pagination && <Pagination page={page} pages={data.pagination.pages} onChange={setPage} />}
    </div>
  );
}
