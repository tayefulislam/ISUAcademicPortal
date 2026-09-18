import {
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignStartHorizontal,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  MoveVertical,
  Trash2,
  ArrowDownToLine,
  ArrowUpToLine,
} from 'lucide-react';

// The property panel for one element. Everything the renderer understands is
// editable here — type, source, geometry, typeface, formatting, image and draw
// order — so a cover design is assembled entirely from the admin UI.
//
// `editable` is deliberately NOT a control: the server derives it from the type
// (a source-backed AUTO field can never be made editable), so offering a toggle
// here would only be a lie.
export default function FieldMappingPanel({
  field,
  meta,
  assets = [],
  pageWidthMm = 210,
  pageHeightMm = 297,
  onChange,
  onDelete,
  onBringToFront,
  onSendToBack,
  onAlign,
}) {
  if (!field) {
    return (
      <p className="text-sm text-slate-400">
        Select an element on the page to edit it, or drag one in from the left.
      </p>
    );
  }

  const set = (patch) => onChange({ ...field, ...patch });
  const setValidation = (patch) => set({ validation: { ...(field.validation || {}), ...patch } });
  const setFormatting = (patch) => set({ formatting: { ...(field.formatting || {}), ...patch } });

  const num = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const isAuto = field.type === 'AUTO';
  const isStatic = field.type === 'STATIC';
  const isDate = field.type === 'DATE';
  const isImage = field.type === 'IMAGE';
  const isLine = field.type === 'LINE';
  const isTextual = !isImage && !isLine;

  const nudge = (dx, dy) => set({
    x: Math.max(0, Math.round((num(field.x, 0) + dx) * 10) / 10),
    y: Math.max(0, Math.round((num(field.y, 0) + dy) * 10) / 10),
  });

  const width = num(field.width, 100);
  const height = isLine ? num(field.height, 0.4) : num(field.height, 8);

  const align = (mode) => {
    if (onAlign) {
      onAlign(mode);
      return;
    }
    // Fallback when the parent does not handle it.
    if (mode === 'center') set({ x: Math.round(((pageWidthMm - width) / 2) * 10) / 10 });
    if (mode === 'middle') set({ y: Math.round(((pageHeightMm - height) / 2) * 10) / 10 });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-mono text-slate-400 truncate">{field.key}</span>
        <button
          type="button"
          onClick={onDelete}
          className="p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
          title="Delete element"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {!isLine && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">Label</label>
          <input
            value={field.label || ''}
            onChange={(e) => set({ label: e.target.value })}
            className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm"
          />
        </div>
      )}

      <div>
        <label className="block text-xs text-slate-500 mb-1">Type</label>
        <select
          value={field.type}
          onChange={(e) => set({ type: e.target.value })}
          className="w-full h-10 rounded-lg border border-slate-300 px-2 text-sm bg-white"
        >
          {(meta?.fieldTypes || []).map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <p className="text-[11px] text-slate-400 mt-1">
          {isAuto ? 'Filled from the student/course record — locked.' :
            isStatic ? 'Fixed text printed as-is — locked.' :
            isImage ? 'An image from the server’s img/ folder.' :
            isLine ? 'A rule. Its height is its thickness.' :
            'Typed by the student on the generate screen.'}
        </p>
      </div>

      {isAuto && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">Source</label>
          <select
            value={field.source || ''}
            onChange={(e) => set({ source: e.target.value })}
            className="w-full h-10 rounded-lg border border-slate-300 px-2 text-sm bg-white"
          >
            <option value="">Select a source…</option>
            {(meta?.sources || []).map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      )}

      {isStatic && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">Text</label>
          <input
            value={field.staticValue || ''}
            onChange={(e) => set({ staticValue: e.target.value })}
            className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm"
          />
        </div>
      )}

      {isImage && (
        <div>
          <label className="block text-xs text-slate-500 mb-1">Image</label>
          {assets.length === 0 ? (
            <p className="text-xs text-slate-400">
              No images found. Add files to the server’s <code>img/</code> folder.
            </p>
          ) : (
            <div className="space-y-2">
              <select
                value={field.asset || ''}
                onChange={(e) => set({ asset: e.target.value })}
                className="w-full h-10 rounded-lg border border-slate-300 px-2 text-sm bg-white"
              >
                <option value="">Select an image…</option>
                {assets.map((a) => (
                  <option key={a.name} value={a.name}>{a.name}</option>
                ))}
              </select>
              {field.asset && assets.find((a) => a.name === field.asset)?.url && (
                <img
                  src={assets.find((a) => a.name === field.asset).url}
                  alt=""
                  className="h-16 w-auto rounded border border-slate-200 bg-white p-1"
                />
              )}
            </div>
          )}
        </div>
      )}

      {!isAuto && !isStatic && !isImage && !isLine && (
        <>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={Boolean(field.required)} onChange={(e) => set({ required: e.target.checked })} />
            Required
          </label>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Default value</label>
            <input
              value={field.defaultValue || ''}
              onChange={(e) => set({ defaultValue: e.target.value })}
              className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm"
            />
          </div>
        </>
      )}

      {/* Position */}
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-2">Position &amp; size (mm)</label>
        <div className="grid grid-cols-2 gap-2">
          {['x', 'y', 'width', 'height'].map((prop) => (
            <div key={prop}>
              <label className="block text-[11px] text-slate-400 mb-0.5">
                {prop === 'height' ? (isLine ? 'thickness' : 'height') : prop}
              </label>
              <input
                type="number"
                step="0.5"
                value={field[prop] ?? ''}
                onChange={(e) => set({ [prop]: e.target.value })}
                className="w-full h-9 rounded-lg border border-slate-300 px-2 text-sm"
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1 mt-2">
          <div className="grid grid-cols-3 gap-0.5">
            <span />
            <button type="button" onClick={() => nudge(0, -1)} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Up 1 mm">
              <ArrowUp size={13} />
            </button>
            <span />
            <button type="button" onClick={() => nudge(-1, 0)} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Left 1 mm">
              <ArrowLeft size={13} />
            </button>
            <button type="button" onClick={() => nudge(0, 1)} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Down 1 mm">
              <ArrowDown size={13} />
            </button>
            <button type="button" onClick={() => nudge(1, 0)} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Right 1 mm">
              <ArrowRight size={13} />
            </button>
          </div>

          <div className="flex items-center gap-1 ml-auto">
            <button type="button" onClick={() => align('left')} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Align to left edge">
              <AlignStartHorizontal size={14} />
            </button>
            <button type="button" onClick={() => align('center')} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Centre horizontally">
              <AlignCenterHorizontal size={14} />
            </button>
            <button type="button" onClick={() => align('right')} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Align to right edge">
              <AlignEndHorizontal size={14} />
            </button>
            <button type="button" onClick={() => align('middle')} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Centre vertically">
              <MoveVertical size={14} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 mt-2">
          <span className="text-[11px] text-slate-400 mr-1">Order</span>
          <button type="button" onClick={onSendToBack} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Send to back">
            <ArrowDownToLine size={14} />
          </button>
          <button type="button" onClick={onBringToFront} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Bring to front">
            <ArrowUpToLine size={14} />
          </button>
          <span className="text-[11px] text-slate-400 ml-auto">z {num(field.zIndex, 0)}</span>
        </div>
      </div>

      {/* Typeface — text elements and rules only. */}
      {isTextual && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Font size (pt)</label>
              <input
                type="number"
                value={field.fontSize ?? 12}
                onChange={(e) => set({ fontSize: e.target.value })}
                className="w-full h-9 rounded-lg border border-slate-300 px-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Align</label>
              <select
                value={field.align || 'left'}
                onChange={(e) => set({ align: e.target.value })}
                className="w-full h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white"
              >
                {(meta?.alignments || ['left', 'center', 'right']).map((a) => (
                  <option key={a} value={a}>{a}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={Boolean(field.bold)} onChange={(e) => set({ bold: e.target.checked })} />
              Bold
            </label>
            <label className="flex items-center gap-1.5 text-sm text-slate-600">
              <input type="checkbox" checked={Boolean(field.italic)} onChange={(e) => set({ italic: e.target.checked })} />
              Italic
            </label>
          </div>
        </>
      )}

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="color"
          value={field.color && /^#[0-9a-fA-F]{6}$/.test(field.color) ? field.color : '#111111'}
          onChange={(e) => set({ color: e.target.value })}
          className="w-7 h-7 rounded border border-slate-300"
        />
        {isLine ? 'Line colour' : 'Text colour'}
      </label>

      {isTextual && (
        <details className="border-t border-slate-100 pt-3">
          <summary className="text-xs font-semibold text-slate-500 cursor-pointer">Formatting &amp; validation</summary>
          <div className="mt-3 space-y-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Prefix</label>
              <input
                value={field.formatting?.prefix || ''}
                onChange={(e) => setFormatting({ prefix: e.target.value })}
                placeholder="e.g. Course Code: "
                className="w-full h-9 rounded-lg border border-slate-300 px-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Suffix</label>
              <input
                value={field.formatting?.suffix || ''}
                onChange={(e) => setFormatting({ suffix: e.target.value })}
                className="w-full h-9 rounded-lg border border-slate-300 px-2 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={Boolean(field.formatting?.uppercase)}
                onChange={(e) => setFormatting({ uppercase: e.target.checked })}
              />
              Uppercase
            </label>
            {isDate && (
              <div>
                <label className="block text-xs text-slate-500 mb-1">Date format</label>
                <select
                  value={field.formatting?.dateFormat || ''}
                  onChange={(e) => setFormatting({ dateFormat: e.target.value })}
                  className="w-full h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white"
                >
                  {(meta?.dateFormats || ['']).map((f) => (
                    <option key={f || 'default'} value={f}>{f || 'Default (YYYY-MM-DD)'}</option>
                  ))}
                </select>
              </div>
            )}
            {!isAuto && !isStatic && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Max length</label>
                  <input
                    type="number"
                    value={field.validation?.maxLength ?? 0}
                    onChange={(e) => setValidation({ maxLength: e.target.value })}
                    className="w-full h-9 rounded-lg border border-slate-300 px-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Pattern</label>
                  <input
                    value={field.validation?.regex || ''}
                    onChange={(e) => setValidation({ regex: e.target.value })}
                    placeholder="^[0-9]+$"
                    className="w-full h-9 rounded-lg border border-slate-300 px-2 text-sm"
                  />
                </div>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
