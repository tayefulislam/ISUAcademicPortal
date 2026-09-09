import { useEffect, useRef, useState } from 'react';
import { Maximize, Download, ExternalLink, RefreshCw, AlertTriangle } from 'lucide-react';

// Renders Word/PowerPoint/Excel documents (doc, docx, ppt, pptx, xls, xlsx)
// via a third-party rendering service embedded in an iframe — the browser
// has no native viewer for these formats the way it does for PDF/images, so
// there's no local-rendering alternative here (unlike PdfViewer, which uses
// pdf.js entirely client-side).
//
// Both services require `fileUrl` to be a publicly reachable HTTPS URL (they
// fetch it server-side to render) — this app's stored files already are
// (R2/S3 public URLs or the Uploadcare CDN), so this works as-is in any
// deployed environment. It will NOT work against a `localhost` fileUrl,
// since Microsoft/Google's servers can't reach a developer's own machine —
// an inherent limitation of this approach, not a bug in this component.
//
// Neither service's failure mode is detectable from the parent page (a
// cross-origin iframe's `onLoad` fires once ITS document loads, regardless
// of whether that document is the real preview or that service's own error
// page) — so instead of pretending to detect failure, this always keeps
// Download/Open-in-new-tab visible and offers a manual "Switch viewer" retry.
const ENGINES = {
  office: { label: 'Microsoft Office', src: (url) => `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}` },
  google: { label: 'Google Docs', src: (url) => `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true` },
};

const SLOW_LOAD_MS = 7000;

export default function OfficeViewer({ fileUrl, onDownload }) {
  const [engine, setEngine] = useState('office');
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    setLoaded(false);
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(timer);
  }, [engine, reloadKey, fileUrl]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  const switchEngine = () => {
    setEngine((e) => (e === 'office' ? 'google' : 'office'));
    setReloadKey((k) => k + 1);
  };

  const retry = () => setReloadKey((k) => k + 1);

  return (
    <div ref={containerRef} className="bg-slate-100 rounded-xl overflow-hidden border border-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2 border-b border-slate-200">
        <span className="text-xs text-slate-400">Viewer: {ENGINES[engine].label}</span>
        <div className="flex items-center gap-1.5">
          <button onClick={switchEngine} title="Try a different viewer" className="flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-slate-100 text-xs text-slate-600">
            <RefreshCw size={14} /> Switch viewer
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

      <div className="relative h-[75vh] min-h-[420px] bg-white">
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm bg-white">
            Loading preview...
          </div>
        )}
        <iframe
          key={`${engine}-${reloadKey}`}
          src={ENGINES[engine].src(fileUrl)}
          title="Document preview"
          className="w-full h-full border-0"
          onLoad={() => setLoaded(true)}
        />
      </div>

      {slow && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-amber-50 border-t border-amber-100 text-xs text-amber-700">
          <AlertTriangle size={14} className="shrink-0" />
          <span>Taking a while, or nothing showing? The preview needs the file to be reachable over the internet.</span>
          <button onClick={retry} className="underline font-medium">Retry</button>
          <button onClick={switchEngine} className="underline font-medium">Switch viewer</button>
        </div>
      )}
    </div>
  );
}
