import { useRef, useState } from 'react';
import MathText from './MathText.jsx';

const SNIPPETS = [
  { label: 'x²', insert: 'x^{2}' },
  { label: '√x', insert: '\\sqrt{x}' },
  { label: 'a/b', insert: '\\frac{a}{b}' },
  { label: '∫', insert: '\\int_{0}^{1} x \\, dx' },
  { label: 'Σ', insert: '\\sum_{i=1}^{n} i' },
  { label: '±', insert: '\\pm' },
  { label: '≤', insert: '\\leq' },
  { label: '≥', insert: '\\geq' },
  { label: 'π', insert: '\\pi' },
  { label: '∞', insert: '\\infty' },
];

// A plain textarea (no WYSIWYG dependency) with buttons that insert common
// LaTeX snippets wrapped in $...$ at the cursor, plus a live KaTeX preview —
// meets "insert/edit equations without writing HTML" without a heavy rich
// text editor. Question text is stored as this same plain string with
// $...$/$$...$$ delimiters and rendered via MathText.jsx everywhere else.
export default function MathEditor({ value, onChange, placeholder, rows = 4 }) {
  const textareaRef = useRef(null);
  const [showPreview, setShowPreview] = useState(true);

  const insertSnippet = (snippet) => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const wrapped = `$${snippet}$`;
    const next = value.slice(0, start) + wrapped + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + wrapped.length, start + wrapped.length);
    });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 mb-1.5">
        {SNIPPETS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => insertSnippet(s.insert)}
            title={s.insert}
            className="px-2 py-1 rounded border border-slate-300 text-xs font-mono text-slate-600 hover:bg-slate-100"
          >
            {s.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowPreview((p) => !p)}
          className="ml-auto px-2 py-1 rounded text-xs text-brand-600 hover:underline"
        >
          {showPreview ? 'Hide preview' : 'Show preview'}
        </button>
      </div>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full rounded-lg border border-slate-300 p-2.5 text-sm font-mono"
      />
      <p className="text-xs text-slate-400 mt-1">Wrap math in $...$ (inline) or $$...$$ (display), e.g. $x^2 + 1$</p>
      {showPreview && value && (
        <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-sm">
          <MathText text={value} />
        </div>
      )}
    </div>
  );
}
