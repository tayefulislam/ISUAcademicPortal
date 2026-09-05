import { useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize, Download, X } from 'lucide-react';

export default function ImageViewer({ fileUrl, title, onDownload, onClose }) {
  const [scale, setScale] = useState(1);
  const containerRef = useRef(null);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  return (
    <div ref={containerRef} className="bg-slate-900 rounded-xl overflow-hidden border border-slate-200">
      <div className="flex items-center justify-between gap-2 bg-slate-800 px-3 py-2">
        <p className="text-sm text-slate-200 truncate">{title}</p>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setScale((s) => Math.max(0.5, s - 0.2))} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-200">
            <ZoomOut size={18} />
          </button>
          <span className="text-sm text-slate-200 w-12 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={() => setScale((s) => Math.min(4, s + 0.2))} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-200">
            <ZoomIn size={18} />
          </button>
          <button onClick={toggleFullscreen} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-200">
            <Maximize size={18} />
          </button>
          <button onClick={onDownload} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-200">
            <Download size={18} />
          </button>
          {onClose && (
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-slate-700 text-slate-200">
              <X size={18} />
            </button>
          )}
        </div>
      </div>
      <div className="flex justify-center items-center overflow-auto p-4 max-h-[75vh] min-h-[300px]">
        <img
          src={fileUrl}
          alt={title}
          style={{ transform: `scale(${scale})`, transition: 'transform 0.15s ease' }}
          className="max-w-full object-contain"
        />
      </div>
    </div>
  );
}
