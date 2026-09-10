import { useQuery } from '@tanstack/react-query';
import { departmentApi, courseApi, batchApi, categoryApi, chapterApi, topicApi, semesterApi } from '../api/endpoints.js';
import { X } from 'lucide-react';
import SearchableSelect from './SearchableSelect.jsx';

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

// Department/Course/Batch get the searchable combobox (long, growing lists
// benefit most from in-list search); everything else stays a plain select.
function SearchableField({ label, value, onChange, options, disabled, searchPlaceholder }) {
  return (
    <div className="flex-1 min-w-[150px]">
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <SearchableSelect
        value={value}
        onChange={onChange}
        options={options}
        disabled={disabled}
        placeholder="All"
        searchPlaceholder={searchPlaceholder}
        heightClass="h-11 sm:h-10"
      />
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
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });
  const { data: chapters } = useQuery({
    queryKey: ['chapters', filters.course],
    queryFn: () => chapterApi.list({ course: filters.course }),
    enabled: !!filters.course,
  });
  const { data: topics } = useQuery({
    queryKey: ['topics', filters.chapter],
    queryFn: () => topicApi.list({ chapter: filters.chapter }),
    enabled: !!filters.chapter,
  });

  const set = (key) => (val) => {
    const next = { ...filters, [key]: val };
    if (key === 'department') next.course = '';
    if (key === 'course') next.chapter = '';
    if (key === 'chapter') next.topic = '';
    onChange(next);
  };

  const activeCount = Object.values(filters).filter(Boolean).length;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex flex-wrap gap-3">
        <SearchableField
          label="Department"
          value={filters.department}
          onChange={set('department')}
          searchPlaceholder="Search departments..."
          options={(departments?.data || []).map((d) => ({ value: d._id, label: `${d.name} (${d.code})` }))}
        />
        <SearchableField
          label="Course"
          value={filters.course}
          onChange={set('course')}
          searchPlaceholder="Search courses..."
          options={(courses?.data || []).map((c) => ({ value: c._id, label: `${c.name} (${c.courseId})` }))}
        />
        <SearchableField
          label="Batch"
          value={filters.batch}
          onChange={set('batch')}
          searchPlaceholder="Search batches..."
          options={(batches?.data || []).map((b) => ({ value: b.code, label: b.name }))}
        />
        <Select
          label="File Type"
          value={filters.fileType}
          onChange={set('fileType')}
          options={FILE_TYPES.map((t) => ({ value: t, label: t.toUpperCase() }))}
        />
        <Select
          label="Material Type"
          value={filters.category}
          onChange={set('category')}
          options={(categories?.data || []).map((c) => ({ value: c._id, label: c.name }))}
        />
        <Select
          label="Chapter"
          value={filters.chapter}
          onChange={set('chapter')}
          disabled={!filters.course}
          options={(chapters?.data || []).map((c) => ({ value: c._id, label: c.name }))}
        />
        <Select
          label="Topic"
          value={filters.topic}
          onChange={set('topic')}
          disabled={!filters.chapter}
          options={(topics?.data || []).map((t) => ({ value: t._id, label: t.name }))}
        />
        <Select
          label="Semester"
          value={filters.semester}
          onChange={set('semester')}
          options={(semesters?.data || []).map((s) => ({ value: s.name, label: s.name }))}
        />
        <div className="flex-1 min-w-[130px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Academic Year</label>
          <input
            value={filters.academicYear || ''}
            onChange={(e) => set('academicYear')(e.target.value)}
            placeholder="e.g. 2026"
            className="w-full h-10 rounded-lg border border-slate-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="flex-1 min-w-[130px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Uploaded From</label>
          <input
            type="date"
            value={filters.dateFrom || ''}
            onChange={(e) => set('dateFrom')(e.target.value)}
            className="w-full h-10 rounded-lg border border-slate-300 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <div className="flex-1 min-w-[130px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Uploaded To</label>
          <input
            type="date"
            value={filters.dateTo || ''}
            onChange={(e) => set('dateTo')(e.target.value)}
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
