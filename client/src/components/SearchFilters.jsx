import { useQuery } from '@tanstack/react-query';
import { departmentApi, courseApi, batchApi, categoryApi } from '../api/endpoints.js';
import { X } from 'lucide-react';

const FILE_TYPES = ['pdf', 'image', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'txt', 'zip', 'other'];

function Select({ label, value, onChange, options, disabled }) {
  return (
    <div className="flex-1 min-w-[150px]">
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm disabled:bg-slate-100 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function SearchFilters({ filters, onChange, onClear }) {
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data: courses } = useQuery({
    queryKey: ['courses', filters.department],
    queryFn: () => courseApi.list({ department: filters.department, limit: 200 }),
  });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: categoryApi.list });

  const set = (key) => (val) => {
    const next = { ...filters, [key]: val };
    if (key === 'department') next.course = '';
    onChange(next);
  };

  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex flex-wrap gap-3">
        <Select
          label="Department"
          value={filters.department}
          onChange={set('department')}
          options={(departments?.data || []).map((d) => ({ value: d._id, label: `${d.name} (${d.code})` }))}
        />
        <Select
          label="Course"
          value={filters.course}
          onChange={set('course')}
          options={(courses?.data || []).map((c) => ({ value: c._id, label: `${c.name} (${c.courseId})` }))}
        />
        <Select
          label="Batch"
          value={filters.batch}
          onChange={set('batch')}
          options={(batches?.data || []).map((b) => ({ value: b.code, label: b.name }))}
        />
        <Select
          label="File Type"
          value={filters.fileType}
          onChange={set('fileType')}
          options={FILE_TYPES.map((t) => ({ value: t, label: t.toUpperCase() }))}
        />
        <Select
          label="Category"
          value={filters.category}
          onChange={set('category')}
          options={(categories?.data || []).map((c) => ({ value: c._id, label: c.name }))}
        />
        <div className="flex-1 min-w-[130px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Semester</label>
          <input
            value={filters.semester || ''}
            onChange={(e) => set('semester')(e.target.value)}
            placeholder="e.g. 3rd"
            className="w-full h-10 rounded-lg border border-slate-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="flex-1 min-w-[130px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Academic Year</label>
          <input
            value={filters.academicYear || ''}
            onChange={(e) => set('academicYear')(e.target.value)}
            placeholder="e.g. 2026"
            className="w-full h-10 rounded-lg border border-slate-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
      </div>

      {activeCount > 0 && (
        <button
          onClick={onClear}
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-600"
        >
          <X size={14} /> Clear all filters ({activeCount})
        </button>
      )}
    </div>
  );
}
