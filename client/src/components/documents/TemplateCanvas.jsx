import { useCallback, useEffect, useRef, useState } from 'react';
import { resizeBox } from '../../utils/resizeBox.js';

// Millimetres → pixels at 100% zoom. A4 is 210×297 mm, so the page is about
// 500×710 px — small enough to sit beside the panels on a laptop, large enough
// to grab an element accurately. The admin can zoom from the toolbar.
export const DEFAULT_PX_PER_MM = 2.4;

const PAGE_MM = { A4: { w: 210, h: 297 }, LETTER: { w: 215.9, h: 279.4 } };

/** The page size in millimetres, honouring orientation. */
export function pageSizeMm(pageSize = 'A4', orientation = 'portrait') {
  const base = PAGE_MM[String(pageSize || 'A4').toUpperCase()] || PAGE_MM.A4;
  return orientation === 'landscape' ? { w: base.h, h: base.w } : { w: base.w, h: base.h };
}

export function pageSizePx(pageSize = 'A4', orientation = 'portrait', pxPerMm = DEFAULT_PX_PER_MM) {
  const { w, h } = pageSizeMm(pageSize, orientation);
  return { width: Math.round(w * pxPerMm), height: Math.round(h * pxPerMm) };
}

/** How close (in mm) an edge must be to a guide before it snaps. */
const SNAP_MM = 2;

/** The resize grips: four corners and the four sides. */
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

const HEX = /^#[0-9a-fA-F]{6}$/;
const BORDER_STYLES = ['none', 'solid', 'dashed', 'dotted'];

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const roundTo = (value, step) => Math.round(value / step) * step;

/** The border/background a box draws, shared by every element type. */
function boxChrome(field) {
  const width = num(field.borderWidth, 0);
  const style = BORDER_STYLES.includes(field.borderStyle) ? field.borderStyle : 'solid';
  const radius = num(field.borderRadius, 0);
  return {
    border: width > 0 && style !== 'none'
      ? `${Math.max(width * DEFAULT_PX_PER_MM, 1)}px ${style} ${HEX.test(field.borderColor || '') ? field.borderColor : '#111111'}`
      : undefined,
    borderRadius: radius > 0 ? `${radius * DEFAULT_PX_PER_MM}px` : undefined,
    backgroundColor: HEX.test(field.backgroundColor || '') ? field.backgroundColor : undefined,
  };
}

/** The text styling a text element draws with — the same set the PDF applies. */
function textStyle(field) {
  const decorations = [
    field.underline ? 'underline' : '',
    field.strikethrough ? 'line-through' : '',
  ].filter(Boolean).join(' ');

  return {
    fontSize: `${num(field.fontSize, 12) * 1.1}px`,
    fontFamily: field.fontFamily || undefined,
    fontWeight: field.bold ? 700 : 400,
    fontStyle: field.italic ? 'italic' : 'normal',
    textDecoration: decorations || undefined,
    letterSpacing: num(field.letterSpacing, 0) ? `${num(field.letterSpacing, 0) * 0.35}px` : undefined,
    lineHeight: num(field.lineHeight, 1.25),
    textAlign: field.align || 'left',
    color: field.color || '#111111',
  };
}

/**
 * The A4 canvas the admin composes the design on.
 *
 * <p>Coordinates are millimetres throughout — the same units the server renders
 * with (templateEngine.js) — so what is placed here is what prints. Everything
 * drawn (font, weight, decoration, spacing, highlight, border) comes from the
 * same field properties the PDF uses, so the canvas is a real preview rather
 * than an approximation.
 *
 * <p>Elements can be dragged in from the palette, moved, and — once selected —
 * resized by any of the eight grips. They also snap to the page's edges and
 * centre and to one another, with the guide shown only while a snap is active.
 */
export default function TemplateCanvas({
  pageSize = 'A4',
  orientation = 'portrait',
  pxPerMm = DEFAULT_PX_PER_MM,
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
  const { width, height } = pageSizePx(pageSize, orientation, pxPerMm);
  const scale = pxPerMm / DEFAULT_PX_PER_MM;

  const [drag, setDrag] = useState(null);
  const [resize, setResize] = useState(null);
  const [dropActive, setDropActive] = useState(false);
  const [guides, setGuides] = useState({ x: null, y: null });
  const canvasRef = useRef(null);

  const beginChange = useCallback(() => onChangeStart?.(), [onChangeStart]);

  /**
   * The x/y offsets (in mm) that would align the moving box with the page or
   * another element, plus the guide lines to draw while it is aligned there.
   */
  const snapTargets = useCallback((moving, widthMm, heightMm) => {
    const xs = [0, (pageWidthMm - widthMm) / 2, pageWidthMm - widthMm];
    const ys = [0, (pageHeightMm - heightMm) / 2, pageHeightMm - heightMm];
    for (const other of fields) {
      if (other.key === moving) continue;
      const ox = num(other.x, 0);
      const oy = num(other.y, 0);
      const ow = num(other.width, 0);
      const oh = other.type === 'LINE' ? 0 : num(other.height, 0);
      xs.push(ox, ox + ow / 2 - widthMm / 2, ox + ow - widthMm);
      ys.push(oy, oy + oh / 2 - heightMm / 2, oy + oh - heightMm);
    }
    return { xs, ys };
  }, [fields, pageWidthMm, pageHeightMm]);

  const handlePointerMove = useCallback(
    (event) => {
      if (!canvasRef.current) return;

      // ---- Resizing ----
      if (resize) {
        const { dir, startClientX, startClientY, box, line } = resize;
        const next = resizeBox(
          box,
          dir,
          (event.clientX - startClientX) / pxPerMm,
          (event.clientY - startClientY) / pxPerMm,
          {
            line,
            keepShape: event.shiftKey,
            fine: event.ctrlKey || event.metaKey,
            pageWidth: pageWidthMm,
            pageHeight: pageHeightMm,
          }
        );
        onChange(fields.map((f) => (f.key === resize.key ? { ...f, ...next } : f)));
        return;
      }

      // ---- Moving ----
      if (!drag) return;
      const rect = canvasRef.current.getBoundingClientRect();
      let xMm = (event.clientX - rect.left) / pxPerMm - drag.offsetX;
      let yMm = (event.clientY - rect.top) / pxPerMm - drag.offsetY;

      const free = event.ctrlKey || event.metaKey; // Ctrl = free placement
      let guideX = null;
      let guideY = null;

      if (!free) {
        const { xs, ys } = snapTargets(drag.key, drag.widthMm, drag.heightMm);
        const nearestX = xs.find((t) => Math.abs(xMm - t) <= SNAP_MM);
        const nearestY = ys.find((t) => Math.abs(yMm - t) <= SNAP_MM);
        if (nearestX !== undefined) {
          xMm = nearestX;
          guideX = nearestX + drag.widthMm / 2;
        }
        if (nearestY !== undefined) {
          yMm = nearestY;
          guideY = nearestY + drag.heightMm / 2;
        }
      }
      setGuides({ x: guideX, y: guideY });

      const step = free ? 0.1 : 0.5;
      onChange(
        fields.map((f) =>
          f.key === drag.key
            ? { ...f, x: Math.max(0, roundTo(xMm, step)), y: Math.max(0, roundTo(yMm, step)) }
            : f
        )
      );
    },
    [drag, resize, fields, onChange, pxPerMm, pageWidthMm, pageHeightMm, snapTargets]
  );

  useEffect(() => {
    if (!drag && !resize) return undefined;
    const stop = () => {
      setDrag(null);
      setResize(null);
      setGuides({ x: null, y: null });
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
    onDropNew({
      ...payload,
      x: Math.max(0, roundTo((event.clientX - rect.left) / pxPerMm, 0.5)),
      y: Math.max(0, roundTo((event.clientY - rect.top) / pxPerMm, 0.5)),
    });
  };

  const ordered = [...fields].sort((a, b) => num(a?.zIndex, 0) - num(b?.zIndex, 0));
  const selected = fields.find((f) => f.key === selectedKey);

  const selectedBox = selected
    ? {
        x: num(selected.x, 0) * pxPerMm,
        y: num(selected.y, 0) * pxPerMm,
        w: num(selected.width, 100) * pxPerMm,
        h: selected.type === 'LINE' ? 0 : num(selected.height, 8) * pxPerMm,
      }
    : null;

  const startResize = (event, dir) => {
    if (!selected || !selectedBox || selected.locked) return;
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

  const startMove = (event, field) => {
    event.stopPropagation();
    onSelect?.(field.key);
    if (field.locked) return;
    beginChange();
    const rect = event.currentTarget.getBoundingClientRect();
    setDrag({
      key: field.key,
      widthMm: num(field.width, 100),
      heightMm: field.type === 'LINE' ? 0 : num(field.height, 8),
      offsetX: (event.clientX - rect.left) / pxPerMm,
      offsetY: (event.clientY - rect.top) / pxPerMm,
    });
  };

  const selectionClass = (field) => {
    if (field.key !== selectedKey) return 'hover:bg-brand-50/20';
    return field.locked
      ? 'outline outline-2 outline-amber-500 bg-amber-50/30'
      : 'outline outline-2 outline-brand-500 bg-brand-50/40';
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
          const box = {
            left: num(field.x, 0) * pxPerMm,
            top: num(field.y, 0) * pxPerMm,
            width: num(field.width, 100) * pxPerMm,
            zIndex: num(field.zIndex, 0),
            ...boxChrome(field),
          };
          const cursor = field.locked ? 'default' : 'move';

          if (field.type === 'LINE') {
            return (
              <div
                key={field.key}
                role="button"
                tabIndex={0}
                onPointerDown={(e) => startMove(e, field)}
                className={`absolute ${cursor} ${selectionClass(field)}`}
                style={{
                  ...box,
                  height: 0,
                  borderTop: `${Math.max(num(field.height, 0.4) * pxPerMm, 1)}px solid ${field.color || '#111111'}`,
                }}
                title={`${field.label} (line${field.locked ? ', locked' : ''})`}
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
                onPointerDown={(e) => startMove(e, field)}
                className={`absolute ${cursor} grid place-items-center overflow-hidden ${selectionClass(field)}`}
                style={{ ...box, height: num(field.height, 25) * pxPerMm }}
                title={`${field.label} (image${field.asset ? `: ${field.asset}` : ''}${field.locked ? ', locked' : ''})`}
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
              onPointerDown={(e) => startMove(e, field)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect?.(field.key);
              }}
              className={`absolute ${cursor} overflow-hidden whitespace-pre-wrap ${selectionClass(field)}`}
              style={{ ...box, ...textStyle(field), minHeight: Math.max(num(field.fontSize, 12) * 1.35, 8) }}
              title={`${field.label} (${field.type}${field.locked ? ', locked' : ''})`}
            >
              {text}
            </div>
          );
        })}

        {/* Alignment guides, drawn only while a snap is actually in effect. */}
        {guides.x !== null && (
          <div
            className="absolute top-0 bottom-0 border-l border-dashed border-brand-500 pointer-events-none"
            style={{ left: guides.x * pxPerMm }}
          />
        )}
        {guides.y !== null && (
          <div
            className="absolute left-0 right-0 border-t border-dashed border-brand-500 pointer-events-none"
            style={{ top: guides.y * pxPerMm }}
          />
        )}

        {/* The eight resize grips. A locked element shows none. */}
        {selected && selectedBox && !selected.locked && (
          <>
            {(selected.type === 'LINE'
              ? LINE_HANDLES
              : HANDLES.map((h) => h.dir)
            ).map((dir) => {
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
                  className="absolute w-[10px] h-[10px] bg-white border-2 border-brand-600 rounded-[2px] z-50 shadow-sm"
                  style={{ left: points[0], top: points[1], transform: 'translate(-50%, -50%)', cursor }}
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

      {scale !== 1 && (
        <div className="absolute -bottom-5 right-0 text-[10px] text-slate-400">
          {Math.round(pxPerMm / DEFAULT_PX_PER_MM * 100)}%
        </div>
      )}
    </div>
  );
}
