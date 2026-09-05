import { useState } from 'react';
import { ChevronDown, ChevronUp, Download, ExternalLink, FileWarning } from 'lucide-react';
import FileIcon from './FileIcon.jsx';
import PdfViewer from './PdfViewer.jsx';
import ImageViewer from './ImageViewer.jsx';
import { resolveFileUrl, formatBytes } from '../utils/format.js';

export default function AttachmentItem({ attachment, onDownload }) {
  const [expanded, setExpanded] = useState(false);
  const url = resolveFileUrl(attachment.fileUrl);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50"
      >
        <FileIcon type={attachment.fileType} size={18} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-700 truncate">{attachment.originalName}</p>
          <p className="text-xs text-slate-400">
            {attachment.fileType.toUpperCase()} &middot; {formatBytes(attachment.fileSize)}
          </p>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDownload(attachment);
          }}
          className="p-2 rounded-md hover:bg-slate-100 text-slate-500 shrink-0"
          title="Download"
        >
          <Download size={16} />
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="p-2 rounded-md hover:bg-slate-100 text-slate-500 shrink-0"
          title="Open in new tab"
        >
          <ExternalLink size={16} />
        </a>
        {expanded ? <ChevronUp size={18} className="text-slate-400 shrink-0" /> : <ChevronDown size={18} className="text-slate-400 shrink-0" />}
      </button>

      {expanded && (
        <div className="border-t border-slate-200 p-3">
          {attachment.fileType === 'pdf' ? (
            <PdfViewer fileUrl={url} onDownload={() => onDownload(attachment)} />
          ) : attachment.fileType === 'image' ? (
            <ImageViewer fileUrl={url} title={attachment.originalName} onDownload={() => onDownload(attachment)} />
          ) : (
            <div className="flex flex-col items-center text-center gap-2 py-8 text-slate-400">
              <FileWarning size={32} />
              <p className="text-sm">Preview unavailable for this file type.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
