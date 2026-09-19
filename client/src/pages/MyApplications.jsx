import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus, Download, FileType2, Copy, Archive, Trash2, Pencil, Eye } from 'lucide-react';
import { applicationApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { formatDate } from '../utils/format.js';
import CreditBadge from '../components/CreditBadge.jsx';

const STATUS_STYLE = {
  DRAFT: 'bg-slate-100 text-slate-600',
  GENERATED: 'bg-blue-50 text-blue-700',
  EDITED: 'bg-amber-50 text-amber-700',
  EXPORTED: 'bg-emerald-50 text-emerald-700',
  SUBMITTED: 'bg-emerald-100 text-emerald-800',
  ARCHIVED: 'bg-slate-100 text-slate-500',
};

// Every application this account has written — reopen, duplicate or export one
// without touching the original it was copied from.
export default function MyApplications() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['applications'], queryFn: () => applicationApi.list({ limit: 100 }) });
  const applications = data?.data || [];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['applications'] });
  };

  const exportFile = async (application, fileType) => {
    setBusyId(`${application.id}:${fileType}`);
    try {
      const res = fileType === 'PDF'
        ? await applicationApi.generatePdf(application.id)
        : await applicationApi.generateDocx(application.id);
      const created = res.data;
      await applicationApi.downloadExport(created.id);
      toast(`${fileType} generated. Check your downloads.`, 'success');
      invalidate();
    } catch (err) {
      toast(err.response?.data?.message || `Could not generate the ${fileType}`, 'error');
    } finally {
      setBusyId('');
    }
  };

  const act = async (label, fn) => {
    try {
      await fn();
      toast(label, 'success');
      invalidate();
    } catch (err) {
      toast(err.response?.data?.message || 'That did not work', 'error');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">My Applications</h1>
          <p className="text-sm text-slate-500 mt-1">Formal letters you have drafted, edited or exported.</p>
        </div>
        <Link
          to="/write-application"
          className="shrink-0 flex items-center gap-2 h-10 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
        >
          <Plus size={16} /> New Application
        </Link>
      </div>

      <CreditBadge />

      {isLoading ? (
        <p className="text-slate-400">Loading…</p>
      ) : applications.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <FileText className="mx-auto text-slate-300" size={38} />
          <h2 className="mt-3 font-semibold text-slate-700">No applications yet</h2>
          <p className="text-sm text-slate-500 mt-1">Write your first formal application — the AI drafts it, you edit it.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {applications.map((application) => (
            <div key={application.id} className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="shrink-0 w-10 h-10 rounded-lg bg-slate-50 grid place-items-center">
                  <FileText size={18} className="text-slate-400" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-700 truncate">{application.subject || '(no subject yet)'}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {application.applicationTypeName} · {application.recipient?.name || 'No recipient'} · {formatDate(application.createdAt)}
                  </p>
                </div>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_STYLE[application.status] || 'bg-slate-100 text-slate-600'}`}>
                  {application.status}
                </span>
              </div>

              <div className="flex flex-wrap gap-2 mt-4">
                <button
                  onClick={() => navigate(`/write-application?id=${application.id}`)}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <Pencil size={13} /> Open &amp; Edit
                </button>
                <Link
                  to={`/applications/${application.id}`}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <Eye size={13} /> View
                </Link>
                <button
                  onClick={() => exportFile(application, 'PDF')}
                  disabled={busyId === `${application.id}:PDF`}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Download size={13} /> {busyId === `${application.id}:PDF` ? 'Preparing…' : 'PDF'}
                </button>
                <button
                  onClick={() => exportFile(application, 'DOCX')}
                  disabled={busyId === `${application.id}:DOCX`}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <FileType2 size={13} /> {busyId === `${application.id}:DOCX` ? 'Preparing…' : 'DOCX'}
                </button>
                <button
                  onClick={() => act('Duplicated', () => applicationApi.duplicate(application.id))}
                  className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <Copy size={13} /> Duplicate
                </button>
                {application.status !== 'ARCHIVED' && (
                  <button
                    onClick={() => act('Archived', () => applicationApi.archive(application.id))}
                    className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    <Archive size={13} /> Archive
                  </button>
                )}
                {['DRAFT', 'GENERATED', 'EDITED'].includes(application.status) && (
                  <button
                    onClick={() => {
                      if (!window.confirm('Delete this draft? This cannot be undone.')) return;
                      act('Deleted', () => applicationApi.remove(application.id));
                    }}
                    className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
