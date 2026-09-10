import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Eye, Download, Search, Pencil, Trash2 } from 'lucide-react';
import { facultyApi } from '../../api/endpoints.js';
import { formatBytes, formatDate } from '../../utils/format.js';
import { useToast } from '../../context/ToastContext.jsx';
import Pagination from '../../components/Pagination.jsx';
import EditFileModal from '../../components/EditFileModal.jsx';

// Materials within this Faculty member's assigned Department(s)/Course(s) —
// pending student submissions live in the separate Review Queue instead.
export default function FacultyFiles() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['faculty-files', q, page],
    queryFn: () => facultyApi.files({ q: q || undefined, page, limit: 15 }),
  });

  const files = data?.data || [];

  const deleteOne = async (id) => {
    if (!confirm('Delete this file permanently? This cannot be undone.')) return;
    try {
      await facultyApi.removeFile(id);
      toast('File deleted', 'success');
      qc.invalidateQueries({ queryKey: ['faculty-files'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed', 'error');
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-2xl font-bold text-slate-800">Assigned Materials</h1>
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

      <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="p-3 text-left">File</th>
              <th className="p-3 text-left">Department</th>
              <th className="p-3 text-left">Course</th>
              <th className="p-3 text-left">Uploaded</th>
              <th className="p-3 text-left">Views</th>
              <th className="p-3 text-left">Downloads</th>
              <th className="p-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="p-6 text-center text-slate-400">Loading...</td></tr>
            ) : files.length === 0 ? (
              <tr><td colSpan={7} className="p-6 text-center text-slate-400">No materials in your assigned scope.</td></tr>
            ) : (
              files.map((f) => (
                <tr key={f._id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3 max-w-[220px]">
                    <p className="font-medium text-slate-700 truncate">{f.title}</p>
                    <p className="text-xs text-slate-400">
                      {f.fileType.toUpperCase()} &middot; {formatBytes(f.fileSize)} &middot; v{f.currentVersion || 1}
                    </p>
                  </td>
                  <td className="p-3">{f.departmentCode}</td>
                  <td className="p-3">{f.courseId}</td>
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
                      <button onClick={() => setEditing(f)} className="p-1.5 rounded hover:bg-slate-100" title="Edit">
                        <Pencil size={16} />
                      </button>
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

      <div className="md:hidden space-y-3">
        {files.map((f) => (
          <div key={f._id} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="font-medium text-slate-700 truncate">{f.title}</p>
            <p className="text-xs text-slate-400 mt-0.5">{f.departmentCode} &middot; {f.courseId}</p>
            <div className="flex gap-2 mt-3">
              <Link to={`/files/${f._id}`} className="flex-1 text-center py-1.5 rounded-md border border-slate-300 text-sm">View</Link>
              <button onClick={() => setEditing(f)} className="flex-1 text-center py-1.5 rounded-md border border-slate-300 text-sm">Edit</button>
              <button onClick={() => deleteOne(f._id)} className="flex-1 text-center py-1.5 rounded-md border border-red-200 text-red-600 text-sm">Delete</button>
            </div>
          </div>
        ))}
      </div>

      {data?.pagination && <Pagination page={page} pages={data.pagination.pages} onChange={setPage} />}

      {editing && (
        <EditFileModal file={editing} onClose={() => setEditing(null)} invalidateKey="faculty-files" api={facultyApi} />
      )}
    </div>
  );
}
