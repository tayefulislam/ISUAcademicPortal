import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { BookOpen, Upload } from 'lucide-react';
import { facultyApi } from '../../api/endpoints.js';

export default function FacultyCourses() {
  const { data, isLoading } = useQuery({ queryKey: ['faculty-courses'], queryFn: facultyApi.courses });
  const courses = data?.data || [];

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <h1 className="text-2xl font-bold text-slate-800">My Assigned Courses</h1>
        <Link to="/faculty/upload" className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700">
          <Upload size={18} /> Upload Material
        </Link>
      </div>

      {isLoading ? (
        <p className="text-slate-400">Loading...</p>
      ) : courses.length === 0 ? (
        <p className="text-slate-400">No courses assigned to you yet — ask a Super Admin to assign you a Department or Course.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map((c) => (
            <div key={c._id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <BookOpen className="text-brand-600 shrink-0" size={20} />
                <div className="min-w-0">
                  <p className="font-semibold text-slate-700 truncate">{c.name}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{c.courseId} &middot; {c.department?.name} ({c.department?.code})</p>
                  <p className="text-xs text-slate-400 mt-0.5">{c.credit} credits &middot; {c.semester || 'Semester not set'}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
