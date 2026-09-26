import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  UploadCloud,
  Trash2,
  Download,
  RefreshCw,
  X,
  Loader2,
  AlertTriangle,
  Image as ImageIcon,
  Copy,
} from 'lucide-react';
import { uploadApi } from '../api/endpoints.js';
import { useUpload } from '../hooks/useUpload.js';
import { useToast } from '../context/ToastContext.jsx';
import { formatBytes, formatDate } from '../utils/format.js';
import UploadStatusBadge, { isActiveStatus } from '../components/uploads/UploadStatusBadge.jsx';
import Pagination from '../components/Pagination.jsx';
import EmptyState from '../components/EmptyState.jsx';

/**
 * Universal uploads (§16).
 *
 * Upload any file, watch it upload and then process, and manage what came back.
 * The two things this page exists to make legible:
 *
 *   1. the upload is not the end of the job — the row keeps moving from
 *      "Uploading…" through "Processing…" to "Ready" on its own, so the page
 *      polls while anything is in flight and stops the moment nothing is; and
 *   2. what it saved you — original size, stored size, and the difference, per
 *      file, plus what was actually done to it.
 *
 * The bytes go through the API (Path A). The multipart path that uploads
 * straight to the bucket is exposed in the API layer for a native client, which
 * is not subject to browser CORS; a browser would need the bucket's CORS
 * configured to PUT to a presigned URL at all.
 */

const MAX_FILES = 10;
const PAGE_SIZE = 10;

const PDF_PROFILES = [
  { value: 'BALANCED', label: 'Balanced (recommended)' },
  { value: 'HIGH_QUALITY', label: 'High quality — important documents' },
  { value: 'SMALL_SIZE', label: 'Small size — compress harder' },
];

// Plain-language description of what the pipeline did, for the "Optimization"
// column. `none` is a first-class outcome, not a failure — most files are
// already fine as they are, which is the whole point of the decision engine.
const METHOD_LABELS = {
  none: 'Stored as uploaded',
  'image-optimize': 'Image optimization',
  'pdf-image-optimization': 'PDF image optimization',
  'text-compression': 'Text compression',
  deduplicated: 'Deduplicated',
};

const CATEGORY_LABELS = {
  image: 'Image',
  document: 'Document',
  archive: 'Archive',
  video: 'Video',
  audio: 'Audio',
  other: 'Other',
};

/** Fetches a private thumbnail and owns its object URL's lifetime. */
function Thumbnail({ id }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    let alive = true;
    let created = '';
    uploadApi
      .derivativeUrl(id, 'thumbnail')
      .then((u) => {
        created = u;
        if (alive) setUrl(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => {
        // A missing thumbnail is not worth surfacing — the file itself is fine.
      });
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
    };
  }, [id]);

  if (!url) return <Loader2 size={16} className="animate-spin text-slate-300" />;
  return <img src={url} alt="" className="w-10 h-10 rounded-lg object-cover border border-slate-200" />;
}

function UploadRow({ record, onDelete, onRetry, onDownload, busy }) {
  const saved = record.savedBytes > 0;
  const hasThumb = record.category === 'image' && record.derivatives?.thumbnail?.key;
  const canFetch = record.processingStatus === 'COMPLETED' || record.processingStatus === 'FAILED';

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center overflow-hidden">
          {hasThumb ? <Thumbnail id={record.fileId} /> : <ImageIcon size={16} className="text-slate-300" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-slate-700 truncate">{record.originalName}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {CATEGORY_LABELS[record.category] || record.category} · {record.detectedLabel || record.mimeType}
                {' · '}
                {formatDate(record.createdAt)}
              </p>
            </div>
            <UploadStatusBadge status={record.processingStatus} />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 text-xs">
            <div>
              <p className="text-slate-400">Original</p>
              <p className="font-medium text-slate-700">{formatBytes(record.originalSize)}</p>
            </div>
            <div>
              <p className="text-slate-400">Stored</p>
              <p className="font-medium text-slate-700">
                {canFetch ? formatBytes(record.storedSize) : '—'}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Saved</p>
              <p className={`font-medium ${saved ? 'text-emerald-600' : 'text-slate-500'}`}>
                {saved ? `${formatBytes(record.savedBytes)} (${record.savedPercentage}%)` : 'Nothing'}
              </p>
            </div>
            <div>
              <p className="text-slate-400">Optimization</p>
              <p className="font-medium text-slate-700">
                {METHOD_LABELS[record.processingMethod] || record.processingMethod}
                {record.qualityProfile ? ` · ${record.qualityProfile}` : ''}
              </p>
            </div>
          </div>

          {isActiveStatus(record.processingStatus) && (
            <p className="flex items-center gap-2 text-xs text-slate-500 mt-3">
              <Loader2 size={13} className="animate-spin text-blue-500" />
              {record.processingStatus === 'UPLOADING'
                ? 'Uploading…'
                : record.processingStatus === 'QUEUED'
                  ? 'Waiting to be processed…'
                  : 'Optimizing — this page updates on its own.'}
            </p>
          )}

          {record.processingStatus === 'FAILED' && (
            <p className="flex items-start gap-1.5 text-xs text-red-600 mt-3">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                {record.errorMessage || 'This file could not be optimized.'} The original is still available to
                download.
              </span>
            </p>
          )}

          {record.typeMismatch && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 mt-3">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>
                The file&apos;s real type ({record.detectedLabel || record.detectedMimeType}) did not match what was
                declared when it was uploaded.
              </span>
            </p>
          )}

          {record.compression && record.compression !== 'none' && (
            <p className="text-xs text-slate-400 mt-2">
              Stored compressed ({record.compression}) and decompressed automatically on download.
            </p>
          )}

          <div className="flex flex-wrap gap-2 mt-3">
            <button
              onClick={() => onDownload(record)}
              disabled={!canFetch || busy}
              className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={13} /> Download
            </button>
            {record.processingStatus === 'FAILED' && (
              <button
                onClick={() => onRetry(record)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg border border-slate-300 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                <RefreshCw size={13} /> Try again
              </button>
            )}
            <button
              onClick={() => onDelete(record)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 h-8 rounded-lg border border-slate-300 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
            >
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Uploads() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [files, setFiles] = useState([]);
  const [purpose, setPurpose] = useState('');
  const [pdfProfile, setPdfProfile] = useState('BALANCED');
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState([]);
  // Progress and the current file come from the shared upload engine — the same
  // one every upload surface uses.
  const { progress, currentIndex, currentName, uploadMany } = useUpload();
  const [busyId, setBusyId] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['my-uploads', page],
    queryFn: () => uploadApi.mine({ page, limit: PAGE_SIZE }),
    // Poll only while something is still moving, so an idle page makes no
    // requests at all.
    refetchInterval: (query) => {
      const items = query.state.data?.data || [];
      return items.some((f) => isActiveStatus(f.processingStatus)) ? 4000 : false;
    },
  });

  const uploads = data?.data || [];
  const pagination = data?.pagination;

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}_${f.size}`));
      const merged = [...prev];
      for (const f of incoming) {
        const key = `${f.name}_${f.size}`;
        if (!seen.has(key)) {
          merged.push(f);
          seen.add(key);
        }
      }
      if (merged.length > MAX_FILES) {
        toast(`You can upload up to ${MAX_FILES} files at once`, 'error');
        return merged.slice(0, MAX_FILES);
      }
      return merged;
    });
  };

  const removeFile = (index) => setFiles((prev) => prev.filter((_, i) => i !== index));

  const startUpload = async () => {
    if (!files.length) {
      toast('Choose at least one file to upload', 'error');
      return;
    }

    setSubmitting(true);
    setResults([]);

    // The shared engine uploads them sequentially and returns one outcome per
    // file, so a partial batch is reported accurately.
    const outcomes = await uploadMany(files, { purpose, pdfProfile });

    setResults(outcomes);
    setSubmitting(false);
    setFiles([]);

    const failed = outcomes.filter((o) => !o.ok);
    const duplicates = outcomes.reduce((n, o) => n + (o.duplicates?.length ? 1 : 0), 0);

    if (failed.length === 0) {
      toast(
        outcomes.length === 1 ? 'Uploaded — processing in the background.' : `${outcomes.length} files uploaded — processing in the background.`,
        'success'
      );
    } else if (failed.length === outcomes.length) {
      toast(failed[0].message, 'error');
    } else {
      toast(`${outcomes.length - failed.length} uploaded, ${failed.length} failed`, 'error');
    }
    if (duplicates) {
      toast(`${duplicates} file(s) are identical to something already uploaded.`, 'info');
    }

    setPage(1);
    qc.invalidateQueries({ queryKey: ['my-uploads'] });
  };

  const handleDelete = async (record) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Delete "${record.originalName}"? This cannot be undone.`)) return;
    setBusyId(record.fileId);
    try {
      await uploadApi.remove(record.fileId);
      toast('File deleted', 'success');
      qc.invalidateQueries({ queryKey: ['my-uploads'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Could not delete the file', 'error');
    } finally {
      setBusyId('');
    }
  };

  const handleRetry = async (record) => {
    setBusyId(record.fileId);
    try {
      await uploadApi.retry(record.fileId);
      toast('Queued for another attempt', 'success');
      qc.invalidateQueries({ queryKey: ['my-uploads'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Could not retry the file', 'error');
    } finally {
      setBusyId('');
    }
  };

  const handleDownload = async (record) => {
    setBusyId(record.fileId);
    try {
      await uploadApi.downloadToDisk(record.fileId, record.originalName);
    } catch (err) {
      toast(err.response?.data?.message || 'Could not download the file', 'error');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Uploads</h1>
        <p className="text-sm text-slate-500 mt-1">
          Upload any file. It is checked, optimized where that genuinely helps, and stored — and you can keep using this
          page while that happens.
        </p>
      </div>

      {/* ---------- Upload ---------- */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <label
          className="block border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-brand-400 transition-colors"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
        >
          <input type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          <UploadCloud className="mx-auto text-slate-400 mb-2" size={28} />
          <p className="text-sm font-medium text-slate-600">Drag files here, or click to choose</p>
          <p className="text-xs text-slate-400 mt-1">
            Any file type. Up to {MAX_FILES} at a time. Large files are fine.
          </p>
        </label>

        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map((f, i) => (
              <li
                key={`${f.name}_${f.size}`}
                className="flex items-center justify-between text-sm bg-slate-50 rounded-lg px-3 py-2"
              >
                <span className="truncate text-slate-700">{f.name}</span>
                <span className="flex items-center gap-3 shrink-0 ml-3">
                  <span className="text-xs text-slate-400">{formatBytes(f.size)}</span>
                  <button
                    onClick={() => removeFile(i)}
                    disabled={submitting}
                    className="text-slate-400 hover:text-red-600 disabled:opacity-40"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Label (optional)</label>
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g. lecture-notes"
              maxLength={60}
              className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            <p className="text-xs text-slate-400 mt-1">Groups your uploads. Not shown to anyone else.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">PDF quality</label>
            <select
              value={pdfProfile}
              onChange={(e) => setPdfProfile(e.target.value)}
              className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {PDF_PROFILES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-400 mt-1">Applies only to PDFs. Ignored for everything else.</p>
          </div>
        </div>

        {submitting && (
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
              <span className="truncate">
                Uploading {currentIndex + 1} of {files.length} — {currentName}
              </span>
              <span>{progress}%</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2">
              <div className="bg-brand-600 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        <button
          onClick={startUpload}
          disabled={submitting || files.length === 0}
          className="w-full h-11 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-60"
        >
          {submitting
            ? `Uploading… ${progress}%`
            : files.length === 0
              ? 'Upload'
              : `Upload ${files.length} file${files.length === 1 ? '' : 's'}`}
        </button>

        {results.length > 0 && (
          <ul className="space-y-1.5 pt-1">
            {results.map((r) => (
              <li key={r.name} className="flex items-start gap-2 text-xs">
                {r.ok ? (
                  <>
                    <span className="text-emerald-600 font-medium shrink-0">Queued</span>
                    <span className="truncate text-slate-600">{r.name}</span>
                  </>
                ) : (
                  <>
                    <span className="text-red-600 font-medium shrink-0">Failed</span>
                    <span className="truncate text-slate-600">
                      {r.name} — {r.message}
                    </span>
                  </>
                )}
                {r.duplicates?.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-slate-400 shrink-0">
                    <Copy size={11} /> already uploaded
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------- My uploads ---------- */}
      <div>
        <h2 className="text-lg font-semibold text-slate-800 mb-3">My uploads</h2>

        {isLoading ? (
          <p className="flex items-center gap-2 text-slate-400 text-sm">
            <Loader2 size={15} className="animate-spin" /> Loading…
          </p>
        ) : uploads.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl">
            <EmptyState title="Nothing uploaded yet" description="Files you upload will appear here." />
          </div>
        ) : (
          <div className="space-y-3">
            {uploads.map((record) => (
              <UploadRow
                key={record.fileId}
                record={record}
                onDelete={handleDelete}
                onRetry={handleRetry}
                onDownload={handleDownload}
                busy={busyId === record.fileId}
              />
            ))}
          </div>
        )}

        {pagination && <Pagination page={pagination.page} pages={pagination.pages} onChange={setPage} />}
      </div>
    </div>
  );
}
