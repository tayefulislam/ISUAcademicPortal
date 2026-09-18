import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, FileText, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { documentApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import DocumentStatusBadge, { expiryLabel } from '../components/documents/DocumentStatusBadge.jsx';

// One generated document: its live status while it renders, then its download
// and expiry. Polling is bounded to the active states only — a finished document
// makes no further requests.
const ACTIVE = new Set(['QUEUED', 'PROCESSING']);

export default function DocumentDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['document', id],
    queryFn: () => documentApi.get(id),
    refetchInterval: (query) => (ACTIVE.has(query.state.data?.data?.status) ? 4000 : false),
  });
  const doc = data?.data;

  const download = async () => {
    try {
      const res = await documentApi.download(id);
      window.open(res.data.url, '_blank', 'noopener');
    } catch (err) {
      toast(err.response?.data?.message || 'Download failed', 'error');
      qc.invalidateQueries({ queryKey: ['document', id] });
    }
  };

  const remove = async () => {
    if (!confirm('Delete this document?')) return;
    try {
      await documentApi.remove(id);
      toast('Document deleted', 'success');
      navigate('/documents');
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed', 'error');
    }
  };

  if (isLoading) return <p className="max-w-3xl mx-auto px-4 py-16 text-slate-400">Loading…</p>;
  if (!doc) return <p className="max-w-3xl mx-auto px-4 py-16 text-slate-400">Document not found.</p>;

  const expired = doc.expired || (doc.expiresAt && new Date(doc.expiresAt).getTime() <= Date.now());

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <Link to="/documents" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-700 mb-4">
        <ArrowLeft size={15} /> All documents
      </Link>

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <span className="shrink-0 w-12 h-12 rounded-xl bg-slate-50 grid place-items-center">
            <FileText size={20} className="text-slate-400" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold text-slate-800 truncate">{doc.templateName || doc.fileName}</h1>
            <p className="text-xs text-slate-400 mt-1">
              Template v{doc.templateVersion} · {doc.category}
              {doc.fileName ? ` · ${doc.fileName}` : ''}
            </p>
          </div>
          <DocumentStatusBadge status={doc.status} expired={doc.expired} />
        </div>

        <div className="mt-5 pt-5 border-t border-slate-100 text-sm text-slate-600">
          {doc.status === 'QUEUED' && (
            <p className="flex items-center gap-2">
              <Loader2 size={15} className="animate-spin text-slate-400" />
              Your PDF has been added to the generation queue. This page updates on its own.
            </p>
          )}
          {doc.status === 'PROCESSING' && (
            <p className="flex items-center gap-2">
              <Loader2 size={15} className="animate-spin text-blue-500" />
              Generating your PDF…
            </p>
          )}
          {doc.status === 'COMPLETED' && !expired && (
            <p className="text-emerald-700 font-medium">
              PDF ready{doc.expiresAt ? ` · ${expiryLabel(doc.expiresAt)}` : ''}
            </p>
          )}
          {(doc.status === 'EXPIRED' || (expired && doc.status === 'COMPLETED')) && (
            <p className="text-amber-700 font-medium">This document has expired and the file has been removed.</p>
          )}
          {doc.status === 'FAILED' && (
            <div>
              <p className="text-red-600 font-medium">PDF generation failed. Please try again.</p>
              {doc.error && <p className="text-xs text-slate-400 mt-1">{doc.error}</p>}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mt-5">
          {doc.status === 'COMPLETED' && !expired && (
            <button
              onClick={download}
              className="h-10 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 flex items-center gap-2"
            >
              <Download size={15} /> Download
            </button>
          )}
          {(expired || doc.status === 'EXPIRED') && (
            <Link
              to={`/documents/new?template=${doc.templateId}`}
              className="h-10 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 flex items-center gap-2"
            >
              <RefreshCw size={15} /> Generate again
            </Link>
          )}
          {doc.status === 'FAILED' && (
            <Link
              to={`/documents/new?template=${doc.templateId}`}
              className="h-10 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 flex items-center gap-2"
            >
              <RefreshCw size={15} /> Try again
            </Link>
          )}
          <button
            onClick={remove}
            className="h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-red-50 hover:text-red-600 flex items-center gap-2"
          >
            <Trash2 size={15} /> Delete
          </button>
        </div>

        {doc.inputData && Object.keys(doc.inputData).length > 0 && (
          <dl className="mt-6 pt-5 border-t border-slate-100 space-y-1.5">
            {Object.entries(doc.inputData).map(([key, value]) => (
              <div key={key} className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-slate-500">{key.replace(/_/g, ' ')}</dt>
                <dd className="text-sm text-slate-700 text-right">{String(value)}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}
