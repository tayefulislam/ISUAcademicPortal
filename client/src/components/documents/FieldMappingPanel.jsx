import { Trash2 } from 'lucide-react';

// The property panel for one field. Everything the renderer understands is
// editable here — type, source, geometry, typeface and formatting — so a new
// cover design is assembled without code.
//
// `editable` is deliberately NOT a control: the server derives it from the type
// (a source-backed AUTO field can never be made editable), so offering a toggle
// here would only be a lie.
export default function FieldMappingPanel({ field, meta, onChange, onDelete }) {
  if (!field) {
    return (
      <p className="text-sm text-slate-400">
        Select a field on the page to edit it, or add one below.
      </p>
    );
  }

  const set = (patch) => onChange({ ...field, ...patch });
  const setValidation = (patch) => set({ validation: { ...(field.validation || {}), ...patch } });
  const setFormatting = (patch) => set({ formatting: { ...(field.formatting || {}), ...patch } });

  const isAuto = field.type === 'AUTO';
  const isStatic = field.type === 'STATIC';
  const isDate = field.type === 'DATE';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-mono text-slate-400 truncate">{field.key}</span>
        <button
          type="button"
          onClick={onDelete}
          className="p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
          title="Delete field"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div>
        <label className="block text-xs text-slate-500 mb-1">Label</label>
        <input
          value={field.label || ''}
          onChange={(e) => set({ label: e.target.value })}
          className="w-full h-10 rounded-lg border border-slate-300 px-3 text-sm"
        />
      </div>

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

      {!isAuto && !isStatic && (
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

      <div className="grid grid-cols-2 gap-2">
        {['x', 'y', 'width', 'height'].map((prop) => (
          <div key={prop}>
            <label className="block text-xs text-slate-500 mb-1">{prop} (mm)</label>
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
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input
            type="color"
            value={field.color && /^#[0-9a-fA-F]{6}$/.test(field.color) ? field.color : '#111111'}
            onChange={(e) => set({ color: e.target.value })}
            className="w-7 h-7 rounded border border-slate-300"
          />
          Colour
        </label>
      </div>

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
    </div>
  );
}
