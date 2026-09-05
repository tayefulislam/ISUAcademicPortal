import { useState, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize,
  Download,
  ExternalLink,
} from 'lucide-react';

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

export default function PdfViewer({ fileUrl, onDownload }) {
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.1);
  const containerRef = useRef(null);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  return (
    <div ref={containerRef} className="bg-slate-100 rounded-xl overflow-hidden border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2 border-b border-slate-200">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPageNumber((p) => Math.max(1, p - 1))}
            disabled={pageNumber <= 1}
            className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm text-slate-600 min-w-[80px] text-center">
            Page {pageNumber} of {numPages || '-'}
          </span>
          <button
            onClick={() => setPageNumber((p) => Math.min(numPages || p, p + 1))}
            disabled={pageNumber >= (numPages || 1)}
            className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button onClick={() => setScale((s) => Math.max(0.5, s - 0.15))} className="p-1.5 rounded-md hover:bg-slate-100">
            <ZoomOut size={18} />
          </button>
          <span className="text-sm text-slate-600 w-12 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(3, s + 0.15))} className="p-1.5 rounded-md hover:bg-slate-100">
            <ZoomIn size={18} />
          </button>
          <button onClick={toggleFullscreen} className="p-1.5 rounded-md hover:bg-slate-100">
            <Maximize size={18} />
          </button>
          <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-md hover:bg-slate-100">
            <ExternalLink size={18} />
          </a>
          <button onClick={onDownload} className="p-1.5 rounded-md hover:bg-slate-100">
            <Download size={18} />
          </button>
        </div>
      </div>

      <div className="flex justify-center overflow-auto p-4 max-h-[75vh]">
        <Document
          file={fileUrl}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          loading={<p className="text-slate-400 py-20">Loading PDF...</p>}
          error={<p className="text-red-500 py-20">Failed to load PDF.</p>}
        >
          <Page pageNumber={pageNumber} scale={scale} renderAnnotationLayer renderTextLayer />
        </Document>
      </div>
    </div>
  );
}
