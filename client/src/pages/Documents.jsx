import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileText, Plus, Download, Trash2, RefreshCw, Eye } from 'lucide-react';
import { documentApi, authApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import DocumentStatusBadge, { expiryLabel } from '../components/documents/DocumentStatusBadge.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { formatDate } from '../utils/format.js';

// A document is only transiently in one of these; polling stops the moment every
// row is terminal, so an idle list makes no requests at all.
const ACTIVE = new Set(['QUEUED', 'PROCESSING']);

export default function Documents() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ['public-settings'],
    queryFn: authApi.publicSettings,
    staleTime: 60_000,
  });
  const enabled = settings?.data?.documentGeneratorEnabled !== false;

  const { data, isLoading } = useQuery({
    queryKey: ['documents'],
    queryFn: () => documentApi.list({ limit: 50 }),
    enabled,
    refetchInterval: (query) => {
      const items = query.state.data?.data || [];
      return items.some((d) => ACTIVE.has(d.status)) ? 4000 : false;
    },
  });

  const documents = data?.data || [];

  const download = async (doc) => {
    try {
      const res = await documentApi.download(doc._id);
      // The URL is short-lived and never stored — opened immediately, then gone.
      window.open(res.data.url, '_blank', 'noopener');
    } catch (err) {
      toast(err.response?.data?.message || 'Could not prepare the download', 'error');
      qc.invalidateQueries({ queryKey: ['documents'] });
    }
  };

  const remove = async (doc) => {
    if (!confirm('Delete this generated document?')) return;
    try {
      await documentApi.remove(doc._id);
      toast('Document deleted', 'success');
      qc.invalidateQueries({ queryKey: ['documents'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed', 'error');
    }
  };

  if (!enabled) {
    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 text-center">
        <FileText className="mx-auto text-slate-300" size={40} />
        <h1 className="mt-4 text-xl font-bold text-slate-700">Document Generator is turned off</h1>
        <p className="mt-1 text-sm text-slate-500">A Super Admin can enable it under System Management.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Documents</h1>
          <p className="text-sm text-slate-500 mt-1">
            Generate a cover page or other academic document from a published template.
          </p>
        </div>
        <Link
          to="/documents/new"
          className="shrink-0 flex items-center gap-2 h-10 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
        >
          <Plus size={16} /> New document
        </Link>
      </div>

      {isLoading ? (
        <p className="text-slate-400">Loading…</p>
      ) : documents.length === 0 ? (
        <EmptyState
          title="No documents yet"
          description="Generate your first cover page — pick a category and template to get started."
        />
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => {
            const expired = doc.expired || (doc.expiresAt && new Date(doc.expiresAt).getTime() <= Date.now());
            return (
              <div key={doc._id} className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-4">
                <span className="shrink-0 w-10 h-10 rounded-lg bg-slate-50 grid place-items-center">
                  <FileText size={18} className="text-slate-400" />
                </span>

                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-700 truncate">{doc.templateName || doc.fileName}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {formatDate(doc.createdAt)}
                    {doc.status === 'COMPLETED' && !expired && doc.expiresAt ? ` · ${expiryLabel(doc.expiresAt)}` : ''}
                  </p>
                  {doc.status === 'FAILED' && (
                    <p className="text-xs text-red-500 mt-1">Generation failed. Please try again.</p>
                  )}
                </div>

                <DocumentStatusBadge status={doc.status} expired={doc.expired} />

                <div className="flex items-center gap-1 shrink-0">
                  {doc.status === 'COMPLETED' && !expired && (
                    <>
                      <Link
                        to={`/documents/${doc._id}`}
                        className="p-2 rounded-md text-slate-500 hover:bg-slate-100"
                        title="Open"
                      >
                        <Eye size={16} />
                      </Link>
                      <button
                        onClick={() => download(doc)}
                        className="p-2 rounded-md text-brand-600 hover:bg-brand-50"
                        title="Download"
                      >
                        <Download size={16} />
                      </button>
                    </>
                  )}
                  {expired && (
                    <Link
                      to={`/documents/new?template=${doc.templateId}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-600 hover:bg-brand-50 hover:text-brand-700"
                      title="Generate again"
                    >
                      <RefreshCw size={13} /> Generate again
                    </Link>
                  )}
                  <button
                    onClick={() => remove(doc)}
                    className="p-2 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
