import { useCallback, useEffect, useRef, useState } from 'react';

// Millimetres → pixels. A4 is 210×297 mm, so at this scale the canvas is about
// 500×710 px — small enough to see the whole page beside the panels on a laptop,
// large enough to drag an element accurately.
const PX_PER_MM = 2.4;

const PAGE_MM = { A4: { w: 210, h: 297 }, LETTER: { w: 215.9, h: 279.4 } };

/** The page size in millimetres, honouring orientation. */
export function pageSizeMm(pageSize = 'A4', orientation = 'portrait') {
  const base = PAGE_MM[String(pageSize || 'A4').toUpperCase()] || PAGE_MM.A4;
  return orientation === 'landscape' ? { w: base.h, h: base.w } : { w: base.w, h: base.h };
}

export function pageSizePx(pageSize = 'A4', orientation = 'portrait') {
  const { w, h } = pageSizeMm(pageSize, orientation);
  return { width: Math.round(w * PX_PER_MM), height: Math.round(h * PX_PER_MM) };
}

/** How close (in mm) an edge must be to the page centre before it snaps. */
const SNAP_MM = 2;

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The A4 canvas the admin composes the design on.
 *
 * <p>Coordinates are millimetres throughout — the same units the server renders
 * with (templateEngine.js) — so what is placed here is what prints, and the pixel
 * scale is applied only for display. Dragging uses pointer events (mouse and
 * touch alike) and never mutates the DOM: it reports a new position and the
 * parent re-renders, so state stays the single source of truth.
 *
 * <p>Elements can also be dragged IN from the palette: the drop position becomes
 * the new element's coordinates, which is what makes "drag a logo onto the page"
 * work.
 */
export default function TemplateCanvas({
  pageSize = 'A4',
  orientation = 'portrait',
  fields = [],
  assets = {},
  backgroundUrl = '',
  selectedKey = '',
  onSelect,
  onChange,
  onDropNew,
}) {
  const { w: pageWidthMm } = pageSizeMm(pageSize, orientation);
  const { width, height } = pageSizePx(pageSize, orientation);

  const [drag, setDrag] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const [guideX, setGuideX] = useState(null);
  const canvasRef = useRef(null);

  const handlePointerMove = useCallback(
    (event) => {
      if (!drag || !canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();

      let xMm = (event.clientX - rect.left) / PX_PER_MM - drag.offsetX;
      let yMm = (event.clientY - rect.top) / PX_PER_MM - drag.offsetY;

      // Snap to the page's vertical centre — the single most common alignment on
      // a cover, and the one that is hardest to hit by hand. The guide line is
      // shown only while it is actually snapping, so it never lies.
      const centre = (pageWidthMm - drag.widthMm) / 2;
      if (Math.abs(xMm - centre) <= SNAP_MM) {
        xMm = centre;
        setGuideX(pageWidthMm / 2);
      } else {
        setGuideX(null);
      }

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
    [drag, fields, onChange, pageWidthMm]
  );

  useEffect(() => {
    if (!drag) return undefined;
    const stop = () => {
      setDrag(null);
      setGuideX(null);
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stop);
    };
  }, [drag, handlePointerMove]);

  const handleDrop = (event) => {
    event.preventDefault();
    setDropActive(false);
    if (!onDropNew || !canvasRef.current) return;

    const raw = event.dataTransfer.getData('text/plain');
    if (!raw) return;
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const xMm = Math.max(0, Math.round(((event.clientX - rect.left) / PX_PER_MM) * 10) / 10);
    const yMm = Math.max(0, Math.round(((event.clientY - rect.top) / PX_PER_MM) * 10) / 10);
    onDropNew({ ...payload, x: xMm, y: yMm });
  };

  // Painted in the same z order as the renderer, so "bring to front" behaves
  // identically on screen and in the PDF.
  const ordered = [...fields].sort((a, b) => num(a?.zIndex, 0) - num(b?.zIndex, 0));

  return (
    <div className="relative mx-auto" style={{ width, height }}>
      <div
        ref={canvasRef}
        className={`relative bg-white shadow-sm border h-full w-full select-none ${
          dropActive ? 'border-brand-500 border-2' : 'border-slate-300'
        }`}
        style={{
          backgroundImage: backgroundUrl ? `url(${backgroundUrl})` : undefined,
          backgroundSize: '100% 100%',
          backgroundRepeat: 'no-repeat',
        }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onSelect?.('');
        }}
        onDragOver={(e) => {
          if (!onDropNew) return;
          e.preventDefault();
          setDropActive(true);
        }}
        onDragLeave={() => setDropActive(false)}
        onDrop={handleDrop}
      >
        {ordered.map((field) => {
          const selected = field.key === selectedKey;
          const box = {
            left: num(field.x, 0) * PX_PER_MM,
            top: num(field.y, 0) * PX_PER_MM,
            width: num(field.width, 100) * PX_PER_MM,
            zIndex: num(field.zIndex, 0),
          };

          const select = (e) => {
            e.stopPropagation();
            onSelect?.(field.key);
          };

          // A rule: its height IS its thickness.
          if (field.type === 'LINE') {
            return (
              <div
                key={field.key}
                role="button"
                tabIndex={0}
                onPointerDown={(e) => {
                  select(e);
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDrag({ key: field.key, widthMm: num(field.width, 100), offsetX: (e.clientX - rect.left) / PX_PER_MM, offsetY: 0 });
                }}
                className={`absolute cursor-move ${selected ? 'outline outline-2 outline-brand-500' : ''}`}
                style={{
                  ...box,
                  height: 0,
                  borderTop: `${Math.max(num(field.height, 0.4) * PX_PER_MM, 1)}px solid ${field.color || '#111111'}`,
                }}
                title={`${field.label} (line)`}
              />
            );
          }

          // An image element — the university logo, or anything else in img/.
          if (field.type === 'IMAGE') {
            const url = field.asset ? assets[field.asset] : '';
            return (
              <div
                key={field.key}
                role="button"
                tabIndex={0}
                onPointerDown={(e) => {
                  select(e);
                  const rect = e.currentTarget.getBoundingClientRect();
                  setDrag({ key: field.key, widthMm: num(field.width, 40), offsetX: (e.clientX - rect.left) / PX_PER_MM, offsetY: (e.clientY - rect.top) / PX_PER_MM });
                }}
                className={`absolute cursor-move grid place-items-center overflow-hidden ${
                  selected ? 'outline outline-2 outline-brand-500 bg-brand-50/40' : 'hover:bg-brand-50/20'
                }`}
                style={{ ...box, height: num(field.height, 25) * PX_PER_MM }}
                title={`${field.label} (image${field.asset ? `: ${field.asset}` : ''})`}
              >
                {url ? (
                  <img src={url} alt="" draggable={false} className="w-full h-full object-contain" />
                ) : (
                  <span className="text-[10px] text-slate-400">No image</span>
                )}
              </div>
            );
          }

          const text =
            field.type === 'STATIC'
              ? field.staticValue || field.label
              : field.type === 'AUTO'
                ? field.source
                : field.label;

          return (
            <div
              key={field.key}
              role="button"
              tabIndex={0}
              onPointerDown={(e) => {
                select(e);
                const rect = e.currentTarget.getBoundingClientRect();
                setDrag({ key: field.key, widthMm: num(field.width, 100), offsetX: (e.clientX - rect.left) / PX_PER_MM, offsetY: (e.clientY - rect.top) / PX_PER_MM });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect?.(field.key);
              }}
              className={`absolute cursor-move overflow-hidden whitespace-pre-wrap leading-tight ${
                selected ? 'outline outline-2 outline-brand-500 bg-brand-50/40' : 'hover:bg-brand-50/20'
              }`}
              style={{
                ...box,
                minHeight: Math.max(num(field.fontSize, 12) * 1.35, 8),
                fontSize: `${num(field.fontSize, 12) * 1.1}px`,
                fontWeight: field.bold ? 700 : 400,
                fontStyle: field.italic ? 'italic' : 'normal',
                textAlign: field.align || 'left',
                color: field.color || '#111111',
              }}
              title={`${field.label} (${field.type})`}
            >
              {text}
            </div>
          );
        })}

        {/* The alignment guide, shown only while something is snapped to it. */}
        {guideX !== null && (
          <div
            className="absolute top-0 bottom-0 border-l border-dashed border-brand-500 pointer-events-none"
            style={{ left: guideX * PX_PER_MM }}
          />
        )}
      </div>
    </div>
  );
}
