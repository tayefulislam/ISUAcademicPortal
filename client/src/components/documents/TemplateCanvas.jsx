import { useCallback, useEffect, useRef, useState } from 'react';
import { resizeBox } from '../../utils/resizeBox.js';

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

/** The resize grips: four corners and four edges. */
const HANDLES = [
  { dir: 'nw', cursor: 'nwse-resize' },
  { dir: 'n', cursor: 'ns-resize' },
  { dir: 'ne', cursor: 'nesw-resize' },
  { dir: 'w', cursor: 'ew-resize' },
  { dir: 'e', cursor: 'ew-resize' },
  { dir: 'sw', cursor: 'nesw-resize' },
  { dir: 's', cursor: 'ns-resize' },
  { dir: 'se', cursor: 'nwse-resize' },
];

// A rule has no height of its own, so only its length can be dragged; its
// thickness stays a property in the panel.
const LINE_HANDLES = ['w', 'e'];

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const roundTo = (value, step) => Math.round(value / step) * step;

/**
 * The A4 canvas the admin composes the design on.
 *
 * <p>Coordinates are millimetres throughout — the same units the server renders
 * with (templateEngine.js) — so what is placed here is what prints, and the pixel
 * scale is applied only for display. Dragging uses pointer events (mouse and
 * touch alike) and never mutates the DOM: it reports a new position and the
 * parent re-renders, so state stays the single source of truth.
 *
 * <p>Elements can be dragged IN from the palette, MOVED, and — once selected —
 * RESIZED by any of the eight grips. Holding <b>Ctrl</b> while resizing works in
 * 0.1 mm steps instead of 0.5 mm (fine adjustment), and holding <b>Shift</b> on a
 * corner keeps the element's shape.
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
  onChangeStart,
  onChangeEnd,
  onDropNew,
}) {
  const { w: pageWidthMm, h: pageHeightMm } = pageSizeMm(pageSize, orientation);
  const { width, height } = pageSizePx(pageSize, orientation);

  const [drag, setDrag] = useState(null);
  const [resize, setResize] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const [guideX, setGuideX] = useState(null);
  const canvasRef = useRef(null);

  const beginChange = useCallback(() => onChangeStart?.(), [onChangeStart]);

  // ----- Moving -----
  const handlePointerMove = useCallback(
    (event) => {
      if (!canvasRef.current) return;

      if (resize) {
        const { dir, startClientX, startClientY, box, line } = resize;
        const dx = (event.clientX - startClientX) / PX_PER_MM;
        const dy = (event.clientY - startClientY) / PX_PER_MM;

        // The geometry lives in a pure module so its edge cases (the pinned
        // edge, the minimum size, the aspect lock, the fine step) are tested.
        const next = resizeBox(box, dir, dx, dy, {
          line,
          keepShape: event.shiftKey,
          fine: event.ctrlKey || event.metaKey,
          pageWidth: pageWidthMm,
          pageHeight: pageHeightMm,
        });

        onChange(fields.map((f) => (f.key === resize.key ? { ...f, ...next } : f)));
        return;
      }

      if (!drag) return;
      const rect = canvasRef.current.getBoundingClientRect();

      let xMm = (event.clientX - rect.left) / PX_PER_MM - drag.offsetX;
      let yMm = (event.clientY - rect.top) / PX_PER_MM - drag.offsetY;

      // Snap to the page's vertical centre — the most common alignment on a
      // cover, and the hardest to hit by hand. Ctrl bypasses it for a free move.
      const centre = (pageWidthMm - drag.widthMm) / 2;
      if (!event.ctrlKey && !event.metaKey && Math.abs(xMm - centre) <= SNAP_MM) {
        xMm = centre;
        setGuideX(pageWidthMm / 2);
      } else {
        setGuideX(null);
      }

      const step = event.ctrlKey || event.metaKey ? 0.1 : 0.5;
      onChange(
        fields.map((f) =>
          f.key === drag.key
            ? {
                ...f,
                x: Math.max(0, roundTo(xMm, step)),
                y: Math.max(0, roundTo(yMm, step)),
              }
            : f
        )
      );
    },
    [drag, resize, fields, onChange, pageWidthMm, pageHeightMm]
  );

  useEffect(() => {
    if (!drag && !resize) return undefined;
    const stop = () => {
      setDrag(null);
      setResize(null);
      setGuideX(null);
      onChangeEnd?.();
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stop);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stop);
    };
  }, [drag, resize, handlePointerMove, onChangeEnd]);

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
    const xMm = Math.max(0, roundTo((event.clientX - rect.left) / PX_PER_MM, 0.5));
    const yMm = Math.max(0, roundTo((event.clientY - rect.top) / PX_PER_MM, 0.5));
    onDropNew({ ...payload, x: xMm, y: yMm });
  };

  // Painted in the same z order as the renderer, so "bring to front" behaves
  // identically on screen and in the PDF.
  const ordered = [...fields].sort((a, b) => num(a?.zIndex, 0) - num(b?.zIndex, 0));
  const selected = fields.find((f) => f.key === selectedKey);

  const selectedBox = selected
    ? {
        x: num(selected.x, 0) * PX_PER_MM,
        y: num(selected.y, 0) * PX_PER_MM,
        w: num(selected.width, 100) * PX_PER_MM,
        h: selected.type === 'LINE' ? 0 : num(selected.height, 8) * PX_PER_MM,
      }
    : null;

  const startResize = (event, dir) => {
    if (!selected || !selectedBox) return;
    event.stopPropagation();
    event.preventDefault();
    onSelect?.(selected.key);
    beginChange();
    setResize({
      key: selected.key,
      dir,
      line: selected.type === 'LINE',
      startClientX: event.clientX,
      startClientY: event.clientY,
      box: {
        x: num(selected.x, 0),
        y: num(selected.y, 0),
        width: num(selected.width, 100),
        height: num(selected.height, 8),
      },
    });
  };

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
          const isSelected = field.key === selectedKey;
          const box = {
            left: num(field.x, 0) * PX_PER_MM,
            top: num(field.y, 0) * PX_PER_MM,
            width: num(field.width, 100) * PX_PER_MM,
            zIndex: num(field.zIndex, 0),
          };

          const startMove = (e) => {
            e.stopPropagation();
            onSelect?.(field.key);
            beginChange();
            const rect = e.currentTarget.getBoundingClientRect();
            setDrag({
              key: field.key,
              widthMm: num(field.width, 100),
              offsetX: (e.clientX - rect.left) / PX_PER_MM,
              offsetY: (e.clientY - rect.top) / PX_PER_MM,
            });
          };

          if (field.type === 'LINE') {
            return (
              <div
                key={field.key}
                role="button"
                tabIndex={0}
                onPointerDown={startMove}
                className={`absolute cursor-move ${isSelected ? 'outline outline-2 outline-brand-500' : ''}`}
                style={{
                  ...box,
                  height: 0,
                  borderTop: `${Math.max(num(field.height, 0.4) * PX_PER_MM, 1)}px solid ${field.color || '#111111'}`,
                }}
                title={`${field.label} (line)`}
              />
            );
          }

          if (field.type === 'IMAGE') {
            const url = field.asset ? assets[field.asset] : '';
            return (
              <div
                key={field.key}
                role="button"
                tabIndex={0}
                onPointerDown={startMove}
                className={`absolute cursor-move grid place-items-center overflow-hidden ${
                  isSelected ? 'outline outline-2 outline-brand-500 bg-brand-50/40' : 'hover:bg-brand-50/20'
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
              onPointerDown={startMove}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect?.(field.key);
              }}
              className={`absolute cursor-move overflow-hidden whitespace-pre-wrap leading-tight ${
                isSelected ? 'outline outline-2 outline-brand-500 bg-brand-50/40' : 'hover:bg-brand-50/20'
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

        {/* Resize grips for the selected element. */}
        {selected && selectedBox && (
          <>
            {(selected.type === 'LINE' ? LINE_HANDLES : HANDLES.map((h) => h.dir)).map((dir) => {
              const cursor = HANDLES.find((h) => h.dir === dir)?.cursor || 'nwse-resize';
              const points = {
                nw: [selectedBox.x, selectedBox.y],
                n: [selectedBox.x + selectedBox.w / 2, selectedBox.y],
                ne: [selectedBox.x + selectedBox.w, selectedBox.y],
                w: [selectedBox.x, selectedBox.y + selectedBox.h / 2],
                e: [selectedBox.x + selectedBox.w, selectedBox.y + selectedBox.h / 2],
                sw: [selectedBox.x, selectedBox.y + selectedBox.h],
                s: [selectedBox.x + selectedBox.w / 2, selectedBox.y + selectedBox.h],
                se: [selectedBox.x + selectedBox.w, selectedBox.y + selectedBox.h],
              }[dir];

              return (
                <div
                  key={dir}
                  role="button"
                  tabIndex={-1}
                  aria-label={`Resize ${dir}`}
                  onPointerDown={(e) => startResize(e, dir)}
                  className="absolute w-[9px] h-[9px] bg-white border border-brand-600 rounded-[2px] z-50"
                  style={{
                    left: points[0],
                    top: points[1],
                    transform: 'translate(-50%, -50%)',
                    cursor,
                  }}
                />
              );
            })}

            {/* The live size, so a drag is measurable without leaving the canvas. */}
            {(drag || resize) && (
              <div
                className="absolute z-50 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-800 text-white text-[10px] whitespace-nowrap pointer-events-none"
                style={{ left: selectedBox.x + selectedBox.w / 2, top: Math.max(0, selectedBox.y - 18) }}
              >
                {Math.round(num(selected.width, 0) * 10) / 10} × {selected.type === 'LINE'
                  ? Math.round(num(selected.height, 0) * 100) / 100
                  : Math.round(num(selected.height, 0) * 10) / 10} mm
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
