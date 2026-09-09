import { useState } from 'react';
import { ChevronDown, BookOpen } from 'lucide-react';
import { MANUALS } from '../data/manualContent.js';

// One reusable page, mounted once per role area (/manual for students,
// /faculty/manual, /admin/manual, /super-admin/manual) so each user type
// lands on their own manual from their own nav, per the request — the
// content itself just comes from manualContent.js keyed by `role`.
export default function Manual({ role }) {
  const manual = MANUALS[role] || MANUALS.student;
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2 mb-1">
        <BookOpen size={24} className="text-brand-600" /> {manual.heading}
      </h1>
      <p className="text-sm text-slate-500 mb-6">{manual.intro}</p>

      <div className="space-y-2">
        {manual.topics.map((topic, i) => {
          const open = openIndex === i;
          return (
            <div key={topic.title} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenIndex(open ? -1 : i)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <span className="font-semibold text-slate-800">{topic.title}</span>
                <ChevronDown size={18} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
              </button>
              {open && (
                <ul className="px-4 pb-4 space-y-2 text-sm text-slate-600 list-disc list-outside ml-4">
                  {topic.items.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
