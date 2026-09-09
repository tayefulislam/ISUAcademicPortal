import { useState, useRef, useEffect, useMemo } from 'react';
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
import api from '../api/axios.js';

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;

// `previewPath` (from utils/format.js's buildPreviewPath) is fetched here via
// the app's own authenticated axios instance rather than handed to pdf.js as
// a URL — pdf.js's internal fetch enforces CORS (which this app's storage
// buckets don't send headers for) and carries no auth header, so a
// login-required/restricted file's bytes would otherwise 403 even for a
// signed-in viewer who can see the file everywhere else. Fetching the raw
// bytes ourselves and handing pdf.js an ArrayBuffer sidesteps both. `fileUrl`
// remains the original storage URL, used only for Download/Open-in-new-tab
// (both plain links, neither CORS- nor auth-checked).
export default function PdfViewer({ fileUrl, previewPath, onDownload }) {
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.1);
  const [pdfData, setPdfData] = useState(null);
  const [fetchError, setFetchError] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    if (!previewPath) {
      setPdfData(fileUrl || null);
      return;
    }
    let cancelled = false;
    setPdfData(null);
    setFetchError('');
    api
      .get(previewPath, { responseType: 'arraybuffer' })
      .then((res) => {
        if (!cancelled) setPdfData(res.data);
      })
      .catch((err) => {
        if (cancelled) return;
        // An error response still comes back as an ArrayBuffer (the request
        // asked for one) — decode it back to JSON to surface the API's own
        // message (e.g. "no longer available at its storage location")
        // instead of a generic one.
        let message = 'Failed to load PDF.';
        try {
          const text = new TextDecoder().decode(err.response?.data);
          const parsed = JSON.parse(text);
          if (parsed?.message) message = parsed.message;
        } catch {
          // response wasn't JSON (e.g. a network-level failure) — keep the generic message
        }
        setFetchError(message);
      });
    return () => {
      cancelled = true;
    };
  }, [previewPath, fileUrl]);

  // Memoized so react-pdf (which reloads/re-parses whenever its `file` prop
  // is a new object reference) doesn't re-fetch/re-render on every unrelated
  // state change here (page turn, zoom, fullscreen toggle).
  const documentFile = useMemo(
    () => (typeof pdfData === 'string' ? pdfData : pdfData ? { data: pdfData } : null),
    [pdfData]
  );

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
        {fetchError ? (
          <p className="text-red-500 py-20 px-6 text-center">{fetchError}</p>
        ) : !pdfData ? (
          <p className="text-slate-400 py-20">Loading PDF...</p>
        ) : (
          <Document
            file={documentFile}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
            loading={<p className="text-slate-400 py-20">Loading PDF...</p>}
            error={<p className="text-red-500 py-20">Failed to load PDF.</p>}
          >
            <Page pageNumber={pageNumber} scale={scale} renderAnnotationLayer renderTextLayer />
          </Document>
        )}
      </div>
    </div>
  );
}
