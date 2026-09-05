import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function Pagination({ page, pages, onChange }) {
  if (pages <= 1) return null;

  const nums = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, start + 4);
  for (let i = start; i <= end; i += 1) nums.push(i);

  return (
    <div className="flex items-center justify-center gap-1 mt-6">
      <button
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="p-2 rounded-md border border-slate-300 disabled:opacity-40 hover:bg-slate-50"
      >
        <ChevronLeft size={16} />
      </button>
      {nums.map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`w-9 h-9 rounded-md text-sm font-medium ${
            n === page ? 'bg-brand-600 text-white' : 'border border-slate-300 hover:bg-slate-50'
          }`}
        >
          {n}
        </button>
      ))}
      <button
        disabled={page >= pages}
        onClick={() => onChange(page + 1)}
        className="p-2 rounded-md border border-slate-300 disabled:opacity-40 hover:bg-slate-50"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
