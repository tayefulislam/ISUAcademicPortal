import { useEffect } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, FileWarning, Heart } from 'lucide-react';
import { fileApi } from '../api/endpoints.js';
import { useDownloadFile } from '../hooks/useDownloadFile.js';
import { useBookmarkedIds, useToggleBookmark } from '../hooks/useBookmarks.js';
import { useAuth } from '../context/AuthContext.jsx';
import { resolveFileUrl, buildPreviewPath, formatBytes, formatDate, formatTime, isOfficeType } from '../utils/format.js';
import { trackEvent } from '../utils/analytics.js';
import PdfViewer from '../components/PdfViewer.jsx';
import ImageViewer from '../components/ImageViewer.jsx';
import OfficeViewer from '../components/OfficeViewer.jsx';
import FileIcon from '../components/FileIcon.jsx';
import FileCard from '../components/FileCard.jsx';
import AttachmentItem from '../components/AttachmentItem.jsx';

export default function FileDetails() {
  const { id } = useParams();
  const location = useLocation();
  const download = useDownloadFile();
  const { user } = useAuth();
  const bookmarkedIds = useBookmarkedIds();
  const toggleBookmark = useToggleBookmark();

  const { data, isLoading, error } = useQuery({
    queryKey: ['file', id],
    queryFn: () => fileApi.get(id),
    retry: false,
  });
  const { data: related } = useQuery({ queryKey: ['related', id], queryFn: () => fileApi.related(id), enabled: !!id });

  const file = data?.data;

  useEffect(() => {
    if (file) {
      trackEvent('file_view', {
        file_id: file._id,
        file_name: file.title,
        course: file.courseName,
        course_id: file.courseId,
        department: file.departmentCode,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?._id]);

  useEffect(() => {
    if (!file?.title) return;
    const previousTitle = document.title;
    document.title = `${file.title} — Academic File Portal`;
    return () => {
      document.title = previousTitle;
    };
  }, [file?.title]);

  if (isLoading) {
    return <div className="max-w-5xl mx-auto px-4 py-16 text-center text-slate-400">Loading file...</div>;
  }
  if (error?.response?.status === 403) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-16 text-center">
        <FileWarning className="mx-auto text-slate-300 mb-3" size={40} />
        <p className="text-slate-600 font-medium">{user ? 'This material is restricted.' : 'Login Required'}</p>
        <p className="text-sm text-slate-400 mt-1">
          {user
            ? "You don't have access to this material — it may be limited to a specific department, batch, semester, or approved students only."
            : 'Sign in to view this file — you\'ll be brought right back here afterward.'}
        </p>
        {!user && (
          <Link
            to="/login"
            state={{ from: location }}
            className="inline-block mt-4 px-5 py-2.5 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700"
          >
            Sign in to view
          </Link>
        )}
      </div>
    );
  }
  if (!file) {
    return <div className="max-w-5xl mx-auto px-4 py-16 text-center text-slate-400">File not found.</div>;
  }

  const url = resolveFileUrl(file.fileUrl);
  const attachments = file.attachments?.length ? file.attachments : [];
  const multi = attachments.length > 1;

  const downloadAttachment = (attachment) =>
    download({
      _id: file._id,
      title: file.title,
      courseName: file.courseName,
      courseId: file.courseId,
      departmentCode: file.departmentCode,
      fileUrl: attachment.fileUrl,
      originalName: attachment.originalName,
    });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-start gap-4 mb-6">
        <FileIcon type={file.fileType} size={26} />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-slate-800 break-words">{file.title}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {file.department?.name} ({file.departmentCode}) &middot; {file.courseName} ({file.courseId})
          </p>
        </div>
        {user && (
          <button
            onClick={() => toggleBookmark(file)}
            title={bookmarkedIds.has(file._id) ? 'Remove from Favorites' : 'Add to Favorites'}
            className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50"
          >
            <Heart size={16} fill={bookmarkedIds.has(file._id) ? 'currentColor' : 'none'} className={bookmarkedIds.has(file._id) ? 'text-red-500' : 'text-slate-400'} />
            {bookmarkedIds.has(file._id) ? 'Bookmarked' : 'Add to Favorites'}
          </button>
        )}
      </div>

      {multi ? (
        <div className="mb-6 space-y-2">
          <p className="text-sm font-medium text-slate-500 mb-2">{attachments.length} files in this upload</p>
          {attachments.map((a) => (
            <AttachmentItem key={a._id} fileId={file._id} attachment={a} onDownload={downloadAttachment} />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-6">
            {file.fileType === 'pdf' ? (
              <PdfViewer fileUrl={url} previewPath={buildPreviewPath(file._id)} onDownload={() => download(file)} />
            ) : file.fileType === 'image' ? (
              <ImageViewer fileUrl={url} title={file.title} onDownload={() => download(file)} />
            ) : isOfficeType(file.fileType) ? (
              <OfficeViewer fileUrl={url} onDownload={() => download(file)} />
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl p-16 flex flex-col items-center text-center gap-3">
                <FileWarning className="text-slate-300" size={48} />
                <p className="text-slate-500">Preview unavailable for this file type.</p>
                <button
                  onClick={() => download(file)}
                  className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700"
                >
                  <Download size={18} /> Download File
                </button>
              </div>
            )}
          </div>

          <div className="flex gap-3 mb-8">
            <button
              onClick={() => download(file)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700"
            >
              <Download size={18} /> Download
            </button>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-slate-300 font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ExternalLink size={18} /> Open in new tab
            </a>
          </div>
        </>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 bg-white border border-slate-200 rounded-xl p-5 mb-10 text-sm">
        <Detail label="Batch" value={file.allBatches ? 'All Batches' : file.batchCodes?.join(', ') || '-'} />
        <Detail label="Semester" value={file.semester || '-'} />
        <Detail label="Academic Year" value={file.academicYear || '-'} />
        <Detail label="Category" value={file.category?.name || file.categoryName} />
        <Detail label="File Type" value={file.fileType?.toUpperCase()} />
        <Detail label="File Size" value={formatBytes(file.fileSize)} />
        <Detail label="Uploaded Date" value={formatDate(file.createdAt)} />
        <Detail label="Uploaded Time" value={formatTime(file.createdAt)} />
        {file.description && (
          <div className="sm:col-span-2">
            <p className="text-slate-400 text-xs uppercase font-medium mb-1">Description</p>
            <p className="text-slate-700">{file.description}</p>
          </div>
        )}
        {file.keywords?.length > 0 && (
          <div className="sm:col-span-2 flex flex-wrap gap-1.5">
            {file.keywords.map((k) => (
              <span key={k} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs">
                {k}
              </span>
            ))}
          </div>
        )}
      </div>

      {related?.data?.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-slate-800 mb-4">More files from {file.courseName}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {related.data.map((f) => (
              <FileCard key={f._id} file={f} onDownload={download} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-6">
        <Link to="/search" className="text-sm text-brand-600 hover:underline">
          &larr; Back to search results
        </Link>
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-slate-400 text-xs uppercase font-medium">{label}</p>
      <p className="text-slate-700 font-medium">{value}</p>
    </div>
  );
}
