import { useCallback, useEffect, useRef, useState } from 'react';

// Millimetres → pixels. A4 is 210×297 mm, so at this scale the canvas is about
// 500×710 px — small enough to see the whole page beside the property panel on a
// laptop, large enough to drag a field accurately.
const PX_PER_MM = 2.4;

const PAGE_MM = { A4: { w: 210, h: 297 }, LETTER: { w: 215.9, h: 279.4 } };

export function pageSizePx(pageSize = 'A4', orientation = 'portrait') {
  const base = PAGE_MM[String(pageSize || 'A4').toUpperCase()] || PAGE_MM.A4;
  const w = orientation === 'landscape' ? base.h : base.w;
  const h = orientation === 'landscape' ? base.w : base.h;
  return { width: Math.round(w * PX_PER_MM), height: Math.round(h * PX_PER_MM) };
}

/**
 * The A4 canvas the admin positions fields on.
 *
 * <p>Coordinates are millimetres throughout — the same units the server renders
 * with (templateEngine.js) — so what is placed here is what prints, with the
 * pixel scale applied only for display. Dragging uses pointer events (mouse and
 * touch alike) and never touches the DOM directly: it reports a new position and
 * the parent re-renders, so state stays the single source of truth.
 */
export default function TemplateCanvas({
  pageSize = 'A4',
  orientation = 'portrait',
  fields = [],
  backgroundUrl = '',
  selectedKey = '',
  onSelect,
  onChange,
}) {
  const { width, height } = pageSizePx(pageSize, orientation);
  const [drag, setDrag] = useState(null);
  const canvasRef = useRef(null);

  const handlePointerMove = useCallback(
    (event) => {
      if (!drag || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const xMm = (event.clientX - rect.left) / PX_PER_MM - drag.offsetX;
      const yMm = (event.clientY - rect.top) / PX_PER_MM - drag.offsetY;
      onChange(
        fields.map((f) =>
          f.key === drag.key
            ? {
                ...f,
                x: Math.max(0, Math.round(xMm * 10) / 10),
                y: Math.max(0, Math.round(yMm * 10) / 10),
              }
            : f
        )
      );
    },
    [drag, fields, onChange]
  );

  useEffect(() => {
    if (!drag) return undefined;
    const stop = () => setDrag(null);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stop);
    };
  }, [drag, handlePointerMove]);

  return (
    <div
      ref={canvasRef}
      className="relative bg-white shadow-sm border border-slate-300 mx-auto select-none"
      style={{
        width,
        height,
        backgroundImage: backgroundUrl ? `url(${backgroundUrl})` : undefined,
        backgroundSize: '100% 100%',
        backgroundRepeat: 'no-repeat',
      }}
      onPointerDown={(e) => {
        // A click on empty canvas deselects.
        if (e.target === e.currentTarget) onSelect?.('');
      }}
    >
      {fields.map((field) => {
        const selected = field.key === selectedKey;
        return (
          <div
            key={field.key}
            role="button"
            tabIndex={0}
            onPointerDown={(e) => {
              e.stopPropagation();
              onSelect?.(field.key);
              const rect = e.currentTarget.getBoundingClientRect();
              setDrag({
                key: field.key,
                offsetX: (e.clientX - rect.left) / PX_PER_MM,
                offsetY: (e.clientY - rect.top) / PX_PER_MM,
              });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSelect?.(field.key);
            }}
            className={`absolute cursor-move overflow-hidden whitespace-pre-wrap leading-tight ${
              selected ? 'outline outline-2 outline-brand-500 bg-brand-50/40' : 'hover:bg-brand-50/20'
            }`}
            style={{
              left: field.x * PX_PER_MM,
              top: field.y * PX_PER_MM,
              width: field.width * PX_PER_MM,
              minHeight: Math.max(parseFloat(field.fontSize || 12) * 1.35, 8),
              fontSize: `${(parseFloat(field.fontSize) || 12) * 1.1}px`,
              fontWeight: field.bold ? 700 : 400,
              fontStyle: field.italic ? 'italic' : 'normal',
              textAlign: field.align || 'left',
              color: field.color || '#111111',
            }}
            title={`${field.label} (${field.type})`}
          >
            {field.type === 'STATIC'
              ? field.staticValue || field.label
              : field.type === 'AUTO'
                ? field.source
                : field.label}
          </div>
        );
      })}
    </div>
  );
}
