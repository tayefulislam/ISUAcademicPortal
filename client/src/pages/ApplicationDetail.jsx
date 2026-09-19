import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, FileType2, History, Pencil } from 'lucide-react';
import { applicationApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { formatDate } from '../utils/format.js';

// One saved application, read-only: its current text, its exported files and its
// version history. Editing happens on the Write Application screen.
export default function ApplicationDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState('');

  const { data } = useQuery({ queryKey: ['application', id], queryFn: () => applicationApi.get(id) });
  const { data: exportsData } = useQuery({ queryKey: ['application-exports', id], queryFn: () => applicationApi.exports(id) });
  const { data: versionsData } = useQuery({ queryKey: ['application-versions', id], queryFn: () => applicationApi.versions(id) });

  const application = data?.data;
  const exports = exportsData?.data || [];
  const versions = versionsData?.data || [];

  const exportFile = async (fileType) => {
    setBusy(fileType);
    try {
      const res = fileType === 'PDF' ? await applicationApi.generatePdf(id) : await applicationApi.generateDocx(id);
      await applicationApi.downloadExport(res.data.id);
      toast(`${fileType} generated.`, 'success');
      qc.invalidateQueries({ queryKey: ['application-exports', id] });
    } catch (err) {
      toast(err.response?.data?.message || `Could not generate the ${fileType}`, 'error');
    } finally {
      setBusy('');
    }
  };

  if (!application) return <p className="max-w-3xl mx-auto px-4 py-16 text-slate-400">Loading…</p>;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <Link to="/my-applications" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-700 mb-4">
        <ArrowLeft size={15} /> My Applications
      </Link>

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-800 truncate">{application.subject || '(no subject)'}</h1>
            <p className="text-xs text-slate-400 mt-1">
              {application.applicationTypeName} · {application.recipient?.name || 'No recipient'} · v{application.currentVersion} · {application.status}
            </p>
          </div>
          <Link
            to={`/write-application?id=${application.id}`}
            className="shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            <Pencil size={13} /> Edit
          </Link>
        </div>

        <div className="flex flex-wrap gap-2 mt-5">
          <button onClick={() => exportFile('PDF')} disabled={Boolean(busy)} className="flex items-center gap-1.5 h-10 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
            <Download size={15} /> {busy === 'PDF' ? 'Preparing PDF…' : 'Generate PDF'}
          </button>
          <button onClick={() => exportFile('DOCX')} disabled={Boolean(busy)} className="flex items-center gap-1.5 h-10 px-4 rounded-lg border border-brand-300 text-brand-700 text-sm font-semibold hover:bg-brand-50 disabled:opacity-50">
            <FileType2 size={15} /> {busy === 'DOCX' ? 'Preparing Word document…' : 'Generate DOCX'}
          </button>
        </div>

        <pre className="mt-6 whitespace-pre-wrap font-sans text-sm leading-relaxed text-slate-700 border-t border-slate-100 pt-5">
          {application.editedContent || '(empty)'}
        </pre>
      </div>

      {exports.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
          <h2 className="font-semibold text-slate-700 mb-3">Exported files</h2>
          <div className="space-y-2">
            {exports.map((file) => (
              <div key={file.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-700">{file.fileType} — {file.fileName}</span>
                <span className="text-xs text-slate-400">
                  {file.expired ? 'Expired — generate again' : `Available until ${formatDate(file.expiresAt)}`}
                </span>
                {!file.expired && (
                  <button
                    onClick={() => applicationApi.downloadExport(file.id).catch(() => toast('Could not download', 'error'))}
                    className="text-xs font-semibold text-brand-600 hover:underline"
                  >
                    Download
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {versions.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
          <h2 className="font-semibold text-slate-700 mb-3 flex items-center gap-2"><History size={15} /> Versions</h2>
          <div className="space-y-1 text-sm text-slate-600">
            {versions.map((version) => (
              <p key={version.version}>Version {version.version} — {version.source} · {formatDate(version.createdAt)}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
