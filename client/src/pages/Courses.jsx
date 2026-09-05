import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { departmentApi, courseApi } from '../api/endpoints.js';

export default function Courses() {
  const [department, setDepartment] = useState('');
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data: courses, isLoading } = useQuery({
    queryKey: ['courses', department],
    queryFn: () => courseApi.list({ department, limit: 200 }),
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-slate-800">All Courses</h1>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="h-10 rounded-lg border border-slate-300 px-3 text-sm"
        >
          <option value="">All Departments</option>
          {(departments?.data || []).map((d) => (
            <option key={d._id} value={d._id}>
              {d.name} ({d.code})
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="text-slate-400">Loading courses...</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(courses?.data || []).map((c) => (
            <Link
              key={c._id}
              to={`/search?course=${c._id}`}
              className="bg-white border border-slate-200 rounded-xl p-4 hover:border-brand-300 hover:shadow-md transition-all flex gap-3"
            >
              <span className="p-2.5 rounded-lg bg-brand-50 text-brand-600 h-fit">
                <BookOpen size={20} />
              </span>
              <div>
                <p className="font-semibold text-slate-800">{c.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{c.courseId} &middot; {c.department?.code}</p>
                <p className="text-xs text-slate-400 mt-1">{c.credit} credits &middot; {c.semester}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
