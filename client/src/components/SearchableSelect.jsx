import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

// A searchable dropdown used for Department/Course/Batch pickers — a plain
// native <select> has no way to filter a long list by typing, and its touch
// target on mobile is whatever the OS gives it. This renders its own button
// + panel so we control both: a search box to filter options, and a taller
// touch target on small screens (unchanged on desktop).
export default function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = 'Select',
  searchPlaceholder = 'Search...',
  disabled = false,
  required = false,
  className = '',
  // Trigger height: mobile-first then desktop, e.g. 'h-12 sm:h-11'. Defaults
  // to a size larger than any existing plain <select> so mobile always grows
  // — override per-usage to match that page's original desktop height
  // exactly (so desktop stays visually unchanged).
  heightClass = 'h-12 sm:h-11',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const searchRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value));
  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onEscape = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onEscape);
    // Autofocus the search box the moment the panel opens — the whole point
    // is to let the user start typing immediately.
    setTimeout(() => searchRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    setOpen((o) => !o);
    setQuery('');
  };

  const pick = (opt) => {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/* Hidden native input so forms with `required` validation / form
          submission behave the same as a real <select>. */}
      <input type="hidden" value={value || ''} required={required} readOnly />

      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        className={`w-full ${heightClass} flex items-center justify-between gap-2 rounded-lg border px-3 text-sm text-left bg-white
          ${disabled ? 'bg-slate-100 text-slate-400 border-slate-200' : 'border-slate-300 text-slate-800'}
          ${open ? 'ring-2 ring-brand-500 border-transparent' : ''}`}
      >
        <span className={`truncate ${!selected ? 'text-slate-400' : ''}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={16} className="text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
          <div className="relative border-b border-slate-100">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full h-11 sm:h-9 pl-8 pr-8 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>
          <ul className="max-h-60 overflow-y-auto py-1" role="listbox">
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-sm text-slate-400">No matches</li>
            ) : (
              filtered.map((opt) => (
                <li key={opt.value}>
                  <button
                    type="button"
                    onClick={() => pick(opt)}
                    className={`w-full text-left px-3 py-2.5 sm:py-2 text-sm hover:bg-brand-50 ${
                      String(opt.value) === String(value) ? 'bg-brand-50 text-brand-700 font-medium' : 'text-slate-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
