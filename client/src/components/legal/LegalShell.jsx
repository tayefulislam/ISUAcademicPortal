import { Link } from 'react-router-dom';
import { ChevronRight, Info, AlertTriangle, CheckCircle2 } from 'lucide-react';

// Shared shell for the public Legal & Support pages (Privacy, Terms, Help,
// Contact). It reuses the app's existing design language — the same slate
// surfaces, brand colours, rounded-xl cards and max-w-7xl container used
// throughout the portal — so these pages look native rather than bolted on.
//
// Layout: breadcrumbs + page header, then a two-column body on large screens
// (article + sticky table of contents) that collapses to a single readable
// column on mobile. All navigation is real <Link>/<a href> — no JS-only
// navigation — so the pages work when opened directly by URL, including
// inside the Android WebView.

function Breadcrumbs({ current }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4 text-sm">
      <ol className="flex flex-wrap items-center gap-1 text-slate-500">
        <li>
          <Link to="/" className="hover:text-brand-700 hover:underline">
            Home
          </Link>
        </li>
        <li aria-hidden="true" className="flex items-center">
          <ChevronRight size={14} className="text-slate-400" />
        </li>
        <li className="text-slate-700 font-medium" aria-current="page">
          {current}
        </li>
      </ol>
    </nav>
  );
}

export default function LegalShell({ title, intro, metaRows = [], sections = [], children, icon: Icon }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <Breadcrumbs current={title} />

      <header className="mb-8 max-w-3xl">
        <div className="flex items-start gap-3">
          {Icon && (
            <span className="hidden sm:inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
              <Icon size={22} />
            </span>
          )}
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 leading-tight">{title}</h1>
            {intro && <p className="mt-2 text-slate-600 leading-relaxed">{intro}</p>}
          </div>
        </div>

        {metaRows.length > 0 && (
          <dl className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
            {metaRows.map((row) => (
              <div key={row.label} className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
                <dt className="font-medium text-slate-500">{row.label}</dt>
                <dd className="text-slate-800">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </header>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-10 lg:items-start">
        <article className="min-w-0 max-w-3xl">{children}</article>

        {sections.length > 0 && (
          <nav
            aria-label="Table of contents"
            className="mt-10 lg:mt-0 lg:sticky lg:top-24 rounded-xl border border-slate-200 bg-white p-4"
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">On this page</p>
            <ul className="space-y-1.5 text-sm">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="block text-slate-600 hover:text-brand-700 hover:underline leading-snug">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
    </div>
  );
}

export function LegalSection({ id, title, children }) {
  return (
    <section id={id} className="scroll-mt-24 mb-8">
      <h2 className="text-lg sm:text-xl font-semibold text-slate-900 mb-3 pb-2 border-b border-slate-200">{title}</h2>
      <div className="space-y-3 text-slate-700 leading-relaxed">{children}</div>
    </section>
  );
}

export function LegalBullets({ items }) {
  return (
    <ul className="list-disc pl-5 space-y-1.5 marker:text-brand-500">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

const CALLOUT_STYLES = {
  info: { wrap: 'border-brand-200 bg-brand-50 text-brand-900', Icon: Info, icon: 'text-brand-600' },
  warning: { wrap: 'border-amber-200 bg-amber-50 text-amber-900', Icon: AlertTriangle, icon: 'text-amber-600' },
  success: { wrap: 'border-emerald-200 bg-emerald-50 text-emerald-900', Icon: CheckCircle2, icon: 'text-emerald-600' },
};

export function LegalCallout({ tone = 'info', title, children }) {
  const style = CALLOUT_STYLES[tone] || CALLOUT_STYLES.info;
  const { Icon } = style;
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${style.wrap}`}>
      <div className="flex gap-2.5">
        <Icon size={18} className={`mt-0.5 shrink-0 ${style.icon}`} />
        <div className="min-w-0">
          {title && <p className="font-semibold mb-0.5">{title}</p>}
          <div className="space-y-1.5 leading-relaxed">{children}</div>
        </div>
      </div>
    </div>
  );
}

// A small, readable definition-style table for "what we collect / why".
export function LegalTable({ head, rows, caption }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-sm text-left border-collapse">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            {head.map((h) => (
              <th key={h} scope="col" className="px-3 py-2.5 font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, i) => (
            <tr key={i} className="align-top">
              {row.map((cell, j) => (
                <td key={j} className={`px-3 py-2.5 ${j === 0 ? 'font-medium text-slate-800' : 'text-slate-600'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
