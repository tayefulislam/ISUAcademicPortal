import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X, Eye, ExternalLink, Download, FileWarning } from 'lucide-react';
import { reviewApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatBytes, formatDate, resolveFileUrl, buildPreviewPath, isOfficeType } from '../../utils/format.js';
import PdfViewer from '../../components/PdfViewer.jsx';
import ImageViewer from '../../components/ImageViewer.jsx';
import OfficeViewer from '../../components/OfficeViewer.jsx';
import ReportButton from '../../components/ReportButton.jsx';

// Shared by Admin, Super Admin, and Faculty — the server scopes what each
// role actually sees/can act on (reviewController.js), this component just
// renders whatever GET /reviews/pending returns.
//
// A reviewer must be able to inspect the actual submitted material before
// deciding, so each row opens a detail panel with its metadata and an inline
// preview (PDF/image/Office via the same viewers the file page uses; an
// external link opens the link; anything else falls back to download/open).
export default function ReviewQueue() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['pending-reviews'], queryFn: reviewApi.pending });
  const [selected, setSelected] = useState(null);

  const submissions = data?.data || [];

  const approve = async (id) => {
    try {
      await reviewApi.approve(id);
      toast('Submission approved and published', 'success');
      setSelected(null);
      qc.invalidateQueries({ queryKey: ['pending-reviews'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Approve failed', 'error');
    }
  };

  const reject = async (id) => {
    if (!confirm('Reject and permanently delete this submission? This cannot be undone.')) return;
    try {
      await reviewApi.reject(id);
      toast('Submission rejected and deleted', 'success');
      setSelected(null);
      qc.invalidateQueries({ queryKey: ['pending-reviews'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Reject failed', 'error');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Material Submissions</h1>
      <p className="text-sm text-slate-500 mb-4">Student-submitted materials awaiting review.</p>

      {isLoading ? (
        <p className="text-slate-400">Loading...</p>
      ) : submissions.length === 0 ? (
        <p className="text-slate-400">No pending submissions.</p>
      ) : (
        <div className="space-y-3">
          {submissions.map((f) => (
            <div key={f._id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-slate-700">{f.title}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {f.department?.name} &middot; {f.course?.name} ({f.course?.courseId}) &middot;{' '}
                  {f.uploadType === 'external' ? 'External link' : f.fileType?.toUpperCase()} &middot;{' '}
                  {f.uploadType === 'external' ? '—' : formatBytes(f.fileSize)}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">
                  Submitted by {f.uploadedBy?.name} ({f.uploadedBy?.email}) &middot; {formatDate(f.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setSelected(f)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  <Eye size={15} /> Review
                </button>
                <button
                  onClick={() => approve(f._id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700"
                >
                  <Check size={14} /> Approve
                </button>
                <button
                  onClick={() => reject(f._id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-50 text-red-600 border border-red-200 text-sm font-medium hover:bg-red-100"
                >
                  <X size={14} /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <ReviewDetail
          file={selected}
          onClose={() => setSelected(null)}
          onApprove={() => approve(selected._id)}
          onReject={() => reject(selected._id)}
        />
      )}
    </div>
  );
}

function ReviewDetail({ file, onClose, onApprove, onReject }) {
  const isExternal = file.uploadType === 'external';
  const url = resolveFileUrl(file.fileUrl);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-3xl my-6 bg-white rounded-xl shadow-xl">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-800 break-words">{file.title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {file.department?.name} &middot; {file.course?.name} ({file.course?.courseId})
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm border-b border-slate-100">
          <Detail label="File name" value={file.originalName || file.title} />
          <Detail label="File type" value={isExternal ? 'External link' : file.fileType?.toUpperCase()} />
          <Detail label="File size" value={isExternal ? '—' : formatBytes(file.fileSize)} />
          <Detail label="Submitted by" value={file.uploadedBy?.name || '—'} />
          <Detail label="Course" value={file.course?.name || '—'} />
          <Detail label="Semester" value={file.semester || '—'} />
          <Detail label="Submission date" value={formatDate(file.createdAt)} />
        </div>

        <div className="p-5">
          <p className="text-xs uppercase font-medium text-slate-400 mb-2">Submitted material</p>

          {isExternal ? (
            <div className="bg-white border border-slate-200 rounded-xl p-8 flex flex-col items-center text-center gap-3">
              <ExternalLink className="text-sky-500" size={36} />
              <p className="text-slate-600">This submission is an external link.</p>
              <p className="text-xs text-slate-400 break-all max-w-lg">{file.externalUrl}</p>
              <a
                href={file.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700"
              >
                <ExternalLink size={18} /> Open link
              </a>
            </div>
          ) : file.fileType === 'pdf' ? (
            <PdfViewer fileUrl={url} previewPath={buildPreviewPath(file._id)} onDownload={null} />
          ) : file.fileType === 'image' ? (
            <ImageViewer fileUrl={url} title={file.title} onDownload={null} />
          ) : isOfficeType(file.fileType) ? (
            <OfficeViewer fileUrl={url} onDownload={null} />
          ) : (
            <div className="bg-white border border-slate-200 rounded-xl p-12 flex flex-col items-center text-center gap-3">
              <FileWarning className="text-slate-300" size={44} />
              <p className="text-slate-500">No inline preview for this file type.</p>
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700"
              >
                <Download size={18} /> Open / download
              </a>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 p-5 border-t border-slate-100">
          <ReportButton entityType="FILE" entityId={file._id} />
          <div className="flex items-center gap-2">
            <button onClick={onReject} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-50 text-red-600 border border-red-200 text-sm font-medium hover:bg-red-100">
              <X size={15} /> Reject
            </button>
            <button onClick={onApprove} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700">
              <Check size={15} /> Approve
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-slate-400 text-xs uppercase font-medium">{label}</p>
      <p className="text-slate-700 font-medium break-words">{value}</p>
    </div>
  );
}
