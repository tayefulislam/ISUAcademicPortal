import {
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignStartHorizontal,
  ArrowDown,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpToLine,
  Bold,
  Copy,
  Italic,
  Lock,
  LockOpen,
  MoveVertical,
  Strikethrough,
  Trash2,
  Underline,
} from 'lucide-react';

// The property panel for one element — the Word-like "format" pane. Everything
// the renderer understands is editable here: type, source, geometry, typeface,
// decoration, spacing, highlight, borders and draw order, so a document is
// designed entirely from the admin UI.
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
  onDuplicate,
  onBringToFront,
  onSendToBack,
  onAlign,
}) {
  if (!field) {
    return (
      <p className="text-sm text-slate-400">
        Select an element on the page to format it, or drag one in from the left.
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
  const isBox = field.type === 'BOX';
  const isTextual = !isImage && !isLine && !isBox;

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
    if (mode === 'center') set({ x: Math.round(((pageWidthMm - width) / 2) * 10) / 10 });
    if (mode === 'middle') set({ y: Math.round(((pageHeightMm - height) / 2) * 10) / 10 });
  };

  const inputClass = 'w-full h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white';
  const labelClass = 'block text-[11px] text-slate-500 mb-1';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-1">
        <span className="text-xs font-mono text-slate-400 truncate">{field.key}</span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => set({ locked: !field.locked })}
            className={`p-1.5 rounded-md hover:bg-slate-100 ${field.locked ? 'text-amber-600' : 'text-slate-400'}`}
            title={field.locked ? 'Unlock (allow moving)' : 'Lock (prevent moving)'}
          >
            {field.locked ? <Lock size={15} /> : <LockOpen size={15} />}
          </button>
          {onDuplicate && (
            <button type="button" onClick={onDuplicate} className="p-1.5 rounded-md text-slate-400 hover:bg-slate-100" title="Duplicate (Ctrl+D)">
              <Copy size={15} />
            </button>
          )}
          <button type="button" onClick={onDelete} className="p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600" title="Delete">
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {/* ---------- Content ---------- */}
      {!isLine && (
        <div>
          <label className={labelClass}>Name</label>
          <input value={field.label || ''} onChange={(e) => set({ label: e.target.value })} className={inputClass} />
        </div>
      )}

      <div>
        <label className={labelClass}>Type</label>
        <select value={field.type} onChange={(e) => set({ type: e.target.value })} className={inputClass}>
          {(meta?.fieldTypes || []).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <p className="text-[11px] text-slate-400 mt-1">
          {isAuto ? 'Filled from the student/course record — locked.' :
            isStatic ? 'Fixed text printed as-is.' :
            isImage ? 'An image from the server’s img/ folder.' :
            isLine ? 'A rule. Its height is its thickness.' :
            isBox ? 'A drawn box — border and/or shading, no text.' :
            'Typed by the student on the generate screen.'}
        </p>
      </div>

      {isAuto && (
        <div>
          <label className={labelClass}>Source</label>
          <select value={field.source || ''} onChange={(e) => set({ source: e.target.value })} className={inputClass}>
            <option value="">Select a source…</option>
            {(meta?.sources || []).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      )}

      {isStatic && (
        <div>
          <label className={labelClass}>Text</label>
          <input value={field.staticValue || ''} onChange={(e) => set({ staticValue: e.target.value })} className={inputClass} />
        </div>
      )}

      {isImage && (
        <div>
          <label className={labelClass}>Image</label>
          {assets.length === 0 ? (
            <p className="text-xs text-slate-400">No images found. Add files to the server’s <code>img/</code> folder.</p>
          ) : (
            <div className="space-y-2">
              <select value={field.asset || ''} onChange={(e) => set({ asset: e.target.value })} className={inputClass}>
                <option value="">Select an image…</option>
                {assets.map((a) => <option key={a.name} value={a.name}>{a.name}</option>)}
              </select>
              {field.asset && assets.find((a) => a.name === field.asset)?.url && (
                <img src={assets.find((a) => a.name === field.asset).url} alt="" className="h-16 w-auto rounded border border-slate-200 bg-white p-1" />
              )}
            </div>
          )}
        </div>
      )}

      {!isAuto && !isStatic && !isImage && !isLine && !isBox && (
        <>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={Boolean(field.required)} onChange={(e) => set({ required: e.target.checked })} />
            Required
          </label>
          <div>
            <label className={labelClass}>Default value</label>
            <input value={field.defaultValue || ''} onChange={(e) => set({ defaultValue: e.target.value })} className={inputClass} />
          </div>
        </>
      )}

      {/* ---------- Position & size ---------- */}
      <div className="border-t border-slate-100 pt-3">
        <label className="block text-xs font-semibold text-slate-500 mb-2">Position &amp; size (mm)</label>
        <div className="grid grid-cols-2 gap-2">
          {['x', 'y', 'width', 'height'].map((prop) => (
            <div key={prop}>
              <label className={labelClass}>{prop === 'height' ? (isLine ? 'thickness' : 'height') : prop}</label>
              <input
                type="number"
                step="0.5"
                value={field[prop] ?? ''}
                onChange={(e) => set({ [prop]: e.target.value })}
                className={inputClass}
              />
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1 mt-2">
          <div className="grid grid-cols-3 gap-0.5">
            <span />
            <button type="button" onClick={() => nudge(0, -1)} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Up 1 mm"><ArrowUp size={13} /></button>
            <span />
            <button type="button" onClick={() => nudge(-1, 0)} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Left 1 mm"><ArrowLeft size={13} /></button>
            <button type="button" onClick={() => nudge(0, 1)} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Down 1 mm"><ArrowDown size={13} /></button>
            <button type="button" onClick={() => nudge(1, 0)} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Right 1 mm"><ArrowRight size={13} /></button>
          </div>
          <div className="flex items-center gap-1 ml-auto">
            <button type="button" onClick={() => align('left')} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Align left edge"><AlignStartHorizontal size={14} /></button>
            <button type="button" onClick={() => align('center')} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Centre horizontally"><AlignCenterHorizontal size={14} /></button>
            <button type="button" onClick={() => align('right')} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Align right edge"><AlignEndHorizontal size={14} /></button>
            <button type="button" onClick={() => align('middle')} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Centre vertically"><MoveVertical size={14} /></button>
          </div>
        </div>

        <div className="flex items-center gap-1 mt-2">
          <span className="text-[11px] text-slate-400 mr-1">Order</span>
          <button type="button" onClick={onSendToBack} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Send to back"><ArrowDownToLine size={14} /></button>
          <button type="button" onClick={onBringToFront} className="p-1.5 rounded border border-slate-200 hover:bg-slate-50" title="Bring to front"><ArrowUpToLine size={14} /></button>
          <span className="text-[11px] text-slate-400 ml-auto">z {num(field.zIndex, 0)}</span>
        </div>
      </div>

      {/* ---------- Typeface (text and rules) ---------- */}
      {isTextual && (
        <div className="border-t border-slate-100 pt-3 space-y-3">
          <label className="block text-xs font-semibold text-slate-500">Text</label>

          <div>
            <label className={labelClass}>Font</label>
            <select
              value={field.fontFamily || ''}
              onChange={(e) => set({ fontFamily: e.target.value })}
              className={inputClass}
              style={{ fontFamily: field.fontFamily || undefined }}
            >
              {(meta?.fonts || [{ value: '', label: 'Default' }]).map((f) => (
                <option key={f.value || 'default'} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Size (pt)</label>
              <input type="number" value={field.fontSize ?? 12} onChange={(e) => set({ fontSize: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Align</label>
              <select value={field.align || 'left'} onChange={(e) => set({ align: e.target.value })} className={inputClass}>
                {(meta?.alignments || ['left', 'center', 'right']).map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          </div>

          {/* Bold / italic / underline / strike, like a writing toolbar. */}
          <div className="flex items-center gap-1">
            {[
              { key: 'bold', icon: Bold, title: 'Bold' },
              { key: 'italic', icon: Italic, title: 'Italic' },
              { key: 'underline', icon: Underline, title: 'Underline' },
              { key: 'strikethrough', icon: Strikethrough, title: 'Strikethrough' },
            ].map(({ key, icon: Icon, title }) => (
              <button
                key={key}
                type="button"
                title={title}
                onClick={() => set({ [key]: !field[key] })}
                className={`p-2 rounded-md border ${field[key] ? 'bg-brand-50 border-brand-300 text-brand-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Line spacing</label>
              <input type="number" step="0.05" value={field.lineHeight ?? 1.25} onChange={(e) => set({ lineHeight: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Char spacing (pt)</label>
              <input type="number" step="0.5" value={field.letterSpacing ?? 0} onChange={(e) => set({ letterSpacing: e.target.value })} className={inputClass} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="color"
                value={field.color && /^#[0-9a-fA-F]{6}$/.test(field.color) ? field.color : '#111111'}
                onChange={(e) => set({ color: e.target.value })}
                className="w-7 h-7 rounded border border-slate-300"
              />
              Colour
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="color"
                value={field.backgroundColor && /^#[0-9a-fA-F]{6}$/.test(field.backgroundColor) ? field.backgroundColor : '#fff3bf'}
                onChange={(e) => set({ backgroundColor: e.target.value })}
                className="w-7 h-7 rounded border border-slate-300"
              />
              Highlight
            </label>
            {field.backgroundColor && (
              <button type="button" onClick={() => set({ backgroundColor: '' })} className="text-[11px] text-slate-500 hover:text-red-600">
                clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* A rule's colour is its ink; give it one even though it has no typeface. */}
      {isLine && (
        <div className="border-t border-slate-100 pt-3">
          <label className={labelClass}>Line colour</label>
          <input
            type="color"
            value={field.color && /^#[0-9a-fA-F]{6}$/.test(field.color) ? field.color : '#111111'}
            onChange={(e) => set({ color: e.target.value })}
            className="w-9 h-9 rounded border border-slate-300"
          />
        </div>
      )}

      {/* ---------- Borders & shading ---------- */}
      <details className="border-t border-slate-100 pt-3" open={Boolean(num(field.borderWidth, 0))}>
        <summary className="text-xs font-semibold text-slate-500 cursor-pointer">Borders &amp; shading</summary>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Width (mm)</label>
              <input type="number" step="0.1" value={field.borderWidth ?? 0} onChange={(e) => set({ borderWidth: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Style</label>
              <select value={field.borderStyle || 'solid'} onChange={(e) => set({ borderStyle: e.target.value })} className={inputClass}>
                {(meta?.borderStyles || ['none', 'solid', 'dashed', 'dotted']).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 items-end">
            <div>
              <label className={labelClass}>Radius (mm)</label>
              <input type="number" step="0.5" value={field.borderRadius ?? 0} onChange={(e) => set({ borderRadius: e.target.value })} className={inputClass} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="color"
                value={field.borderColor && /^#[0-9a-fA-F]{6}$/.test(field.borderColor) ? field.borderColor : '#111111'}
                onChange={(e) => set({ borderColor: e.target.value })}
                className="w-7 h-7 rounded border border-slate-300"
              />
              Border colour
            </label>
          </div>
        </div>
      </details>

      {/* ---------- Formatting & validation ---------- */}
      {isTextual && (
        <details className="border-t border-slate-100 pt-3">
          <summary className="text-xs font-semibold text-slate-500 cursor-pointer">Prefix, suffix &amp; validation</summary>
          <div className="mt-3 space-y-3">
            <div>
              <label className={labelClass}>Prefix</label>
              <input value={field.formatting?.prefix || ''} onChange={(e) => setFormatting({ prefix: e.target.value })} placeholder="e.g. Course Code: " className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Suffix</label>
              <input value={field.formatting?.suffix || ''} onChange={(e) => setFormatting({ suffix: e.target.value })} className={inputClass} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={Boolean(field.formatting?.uppercase)} onChange={(e) => setFormatting({ uppercase: e.target.checked })} />
              Uppercase
            </label>
            {isDate && (
              <div>
                <label className={labelClass}>Date format</label>
                <select value={field.formatting?.dateFormat || ''} onChange={(e) => setFormatting({ dateFormat: e.target.value })} className={inputClass}>
                  {(meta?.dateFormats || ['']).map((f) => <option key={f || 'default'} value={f}>{f || 'Default (YYYY-MM-DD)'}</option>)}
                </select>
              </div>
            )}
            {!isAuto && !isStatic && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelClass}>Max length</label>
                  <input type="number" value={field.validation?.maxLength ?? 0} onChange={(e) => setValidation({ maxLength: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Pattern</label>
                  <input value={field.validation?.regex || ''} onChange={(e) => setValidation({ regex: e.target.value })} placeholder="^[0-9]+$" className={inputClass} />
                </div>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
