import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * A font picker that renders every option in its own face.
 *
 * <p>A native <code>&lt;select&gt;</code> cannot do this: browsers draw the
 * option list themselves and ignore a per-option <code>font-family</code>, so
 * the admin would be choosing a name from a list that all looked identical. This
 * is a button plus a real listbox, so what each font looks like is the list item
 * itself.
 *
 * @param {{ value?: string, onChange: (value: string) => void, fonts?: Array<{value:string,label:string}>, className?: string }} props
 */
export default function FontSelect({ value = '', onChange, fonts, className = '' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const options = fonts && fonts.length ? fonts : [{ value: '', label: 'Default' }];
  const current = options.find((f) => (f.value || '') === (value || '')) || options[0];

  // Close on a click elsewhere or Escape, like every other menu.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((isOpen) => !isOpen)}
        className="w-full h-9 rounded-lg border border-slate-300 px-2 text-sm bg-white flex items-center justify-between gap-2 text-left"
        style={{ fontFamily: current.value || undefined }}
      >
        <span className="truncate">{current.label}</span>
        <ChevronDown size={14} className="text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg py-1">
          {options.map((font) => {
            const selected = (font.value || '') === (value || '');
            return (
              <button
                key={font.value || 'default'}
                type="button"
                onClick={() => {
                  onChange(font.value || '');
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${
                  selected ? 'bg-brand-50 text-brand-700' : 'text-slate-700'
                }`}
                // The point of the control: each option is set in its own font.
                style={{ fontFamily: font.value || undefined }}
              >
                {font.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
