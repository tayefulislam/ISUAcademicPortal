import { Link } from 'react-router-dom';
import { Eye, Download, Files } from 'lucide-react';
import FileIcon from './FileIcon.jsx';
import { formatBytes, formatDate } from '../utils/format.js';

export default function FileCard({ file, onDownload }) {
  const multi = (file.fileCount ?? 1) > 1;

  return (
    <div className="bg-white rounded-xl border border-slate-200 hover:border-brand-300 hover:shadow-md transition-all p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <FileIcon type={file.fileType} />
        <div className="min-w-0 flex-1">
          <Link
            to={`/files/${file._id}`}
            className="font-semibold text-slate-800 hover:text-brand-700 line-clamp-2 leading-snug"
            title={file.title}
          >
            {file.title}
          </Link>
          <p className="text-xs text-slate-500 mt-0.5">
            {file.departmentCode} &middot; {file.courseName} ({file.courseId})
          </p>
        </div>
      </div>

      {multi && (
        <span className="inline-flex items-center gap-1 w-fit px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 text-xs font-medium">
          <Files size={12} /> {file.fileCount} files
        </span>
      )}

      <div className="flex flex-wrap gap-1.5 text-xs">
        {file.batchCodes?.length ? (
          file.batchCodes.slice(0, 3).map((b) => (
            <span key={b} className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
              {b}
            </span>
          ))
        ) : file.allBatches ? (
          <span className="px-2 py-0.5 rounded-full bg-brand-50 text-brand-700">All batches</span>
        ) : null}
        {file.categoryName && (
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{file.categoryName}</span>
        )}
      </div>

      <div className="text-xs text-slate-400 flex items-center gap-2 flex-wrap">
        <span className="uppercase font-medium text-slate-500">{file.fileType}</span>
        <span>&bull;</span>
        <span>{formatBytes(file.fileSize)}</span>
        <span>&bull;</span>
        <span>{formatDate(file.createdAt)}</span>
      </div>

      <div className="flex items-center justify-between pt-2 mt-auto border-t border-slate-100">
        <div className="flex items-center gap-3 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <Eye size={13} /> {file.views ?? 0}
          </span>
          <span className="flex items-center gap-1">
            <Download size={13} /> {file.downloads ?? 0}
          </span>
        </div>
        <div className="flex gap-2">
          <Link
            to={`/files/${file._id}`}
            className="px-3 py-1.5 text-xs font-semibold rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50"
          >
            View
          </Link>
          {multi ? (
            <Link
              to={`/files/${file._id}`}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700"
            >
              View files
            </Link>
          ) : (
            <button
              onClick={() => onDownload?.(file)}
              className="px-3 py-1.5 text-xs font-semibold rounded-md bg-brand-600 text-white hover:bg-brand-700"
            >
              Download
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
