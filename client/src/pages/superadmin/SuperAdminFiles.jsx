import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Trash2, Eye, Search } from 'lucide-react';
import { superAdminApi } from '../../api/endpoints.js';
import { formatBytes, formatDate } from '../../utils/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import Pagination from '../../components/Pagination.jsx';

export default function SuperAdminFiles() {
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 400);
  const [page, setPage] = useState(1);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['super-admin-files', debouncedQ, page],
    queryFn: () => superAdminApi.listFiles({ q: debouncedQ || undefined, page, limit: 15 }),
  });

  const files = data?.data || [];

  const remove = async (id) => {
    if (!confirm('Delete this file permanently? This cannot be undone.')) return;
    try {
      await superAdminApi.removeFile(id);
      toast('File deleted', 'success');
      qc.invalidateQueries({ queryKey: ['super-admin-files'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed', 'error');
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-slate-800">All Files</h1>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search all files..."
            className="h-10 pl-9 pr-3 rounded-lg border border-slate-300 text-sm w-64"
          />
        </div>
      </div>

      <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="p-3 text-left">File</th>
              <th className="p-3 text-left">Department</th>
              <th className="p-3 text-left">Course</th>
              <th className="p-3 text-left">Uploaded By</th>
              <th className="p-3 text-left">Uploaded</th>
              <th className="p-3 text-left">Views</th>
              <th className="p-3 text-left">Downloads</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={8} className="p-6 text-center text-slate-400">Loading...</td></tr>
            ) : files.length === 0 ? (
              <tr><td colSpan={8} className="p-6 text-center text-slate-400">No files found.</td></tr>
            ) : (
              files.map((f) => (
                <tr key={f._id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3 max-w-[220px]">
                    <p className="font-medium text-slate-700 truncate">{f.title}</p>
                    <p className="text-xs text-slate-400">{f.fileType.toUpperCase()} &middot; {formatBytes(f.fileSize)}</p>
                  </td>
                  <td className="p-3">{f.departmentCode}</td>
                  <td className="p-3">{f.courseId}</td>
                  <td className="p-3">
                    <p className="text-slate-700">{f.uploadedBy?.name || '-'}</p>
                    <p className="text-xs text-slate-400">
                      {f.uploadedBy?.role} &middot; {f.uploadedBy?.email}
                    </p>
                  </td>
                  <td className="p-3">{formatDate(f.createdAt)}</td>
                  <td className="p-3">{f.views}</td>
                  <td className="p-3">{f.downloads}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <Link to={`/files/${f._id}`} className="p-1.5 rounded hover:bg-slate-100" title="View">
                        <Eye size={16} />
                      </Link>
                      <button onClick={() => remove(f._id)} className="p-1.5 rounded hover:bg-red-50 text-red-600" title="Delete">
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

      <div className="md:hidden space-y-3">
        {files.map((f) => (
          <div key={f._id} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="font-medium text-slate-700 truncate">{f.title}</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {f.departmentCode} &middot; {f.courseId} &middot; by {f.uploadedBy?.name} ({f.uploadedBy?.role})
            </p>
            <div className="flex gap-2 mt-3">
              <Link to={`/files/${f._id}`} className="flex-1 text-center py-1.5 rounded-md border border-slate-300 text-sm">View</Link>
              <button onClick={() => remove(f._id)} className="flex-1 text-center py-1.5 rounded-md border border-red-200 text-red-600 text-sm">Delete</button>
            </div>
          </div>
        ))}
      </div>

      {data?.pagination && <Pagination page={page} pages={data.pagination.pages} onChange={setPage} />}
    </div>
  );
}
