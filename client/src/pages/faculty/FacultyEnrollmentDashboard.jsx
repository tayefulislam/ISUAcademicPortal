import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Users } from 'lucide-react';
import { courseEnrollmentApi } from '../../api/endpoints.js';

const TYPE_LABELS = { regular: 'Regular', retake: 'Retake', extra: 'Extra', backlog: 'Backlog', improvement: 'Improvement', advance: 'Advance' };
const TYPE_ORDER = ['regular', 'retake', 'extra', 'backlog', 'improvement', 'advance'];

// Course-centric view: for each of Faculty's own assigned courses, how many
// students are currently enrolled and how they break down by type — the
// server already scopes GET /course-enrollments/summary to Faculty's own
// assignedDepartments/assignedCourses, same as the pending-request queue.
export default function FacultyEnrollmentDashboard() {
  const [expanded, setExpanded] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');

  const { data, isLoading } = useQuery({ queryKey: ['enrollment-summary'], queryFn: courseEnrollmentApi.summary });
  const { data: rosterData } = useQuery({
    queryKey: ['enrollment-roster', expanded, typeFilter],
    queryFn: () => courseEnrollmentApi.list({ course: expanded, enrollmentType: typeFilter || undefined, limit: 200 }),
    enabled: !!expanded,
  });

  const courses = data?.data || [];
  const roster = (rosterData?.data || []).filter((e) => ['active', 'approved'].includes(e.status));

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Course Enrollment</h1>
      <p className="text-sm text-slate-500 mb-6">Students currently enrolled in your assigned courses, by enrollment type.</p>

      {isLoading ? (
        <p className="text-slate-400">Loading...</p>
      ) : courses.length === 0 ? (
        <p className="text-slate-400">No students enrolled in your courses yet.</p>
      ) : (
        <div className="space-y-3">
          {courses.map((c) => (
            <div key={c.course._id} className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === c.course._id ? null : c.course._id)}
                className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-700">
                    {c.course.name} <span className="text-xs text-slate-400 font-normal">({c.course.courseId})</span>
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{c.course.department?.code}</p>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="flex items-center gap-1.5 text-sm text-slate-600">
                    <Users size={14} /> {c.total}
                  </div>
                  <div className="hidden sm:flex gap-1.5">
                    {TYPE_ORDER.filter((t) => c.counts[t]).map((t) => (
                      <span key={t} className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                        {TYPE_LABELS[t]}: {c.counts[t]}
                      </span>
                    ))}
                  </div>
                  {expanded === c.course._id ? <ChevronDown size={18} className="text-slate-400" /> : <ChevronRight size={18} className="text-slate-400" />}
                </div>
              </button>

              {expanded === c.course._id && (
                <div className="border-t border-slate-100 p-4">
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    <button
                      onClick={() => setTypeFilter('')}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border ${!typeFilter ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-300 text-slate-600'}`}
                    >
                      All
                    </button>
                    {TYPE_ORDER.filter((t) => c.counts[t]).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTypeFilter(t)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border ${typeFilter === t ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-300 text-slate-600'}`}
                      >
                        {TYPE_LABELS[t]} ({c.counts[t]})
                      </button>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    {roster.length === 0 ? (
                      <p className="text-xs text-slate-400">No students match this filter.</p>
                    ) : (
                      roster.map((e) => (
                        <div key={e._id} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-50 last:border-0">
                          <span className="text-slate-700">{e.student?.name} <span className="text-xs text-slate-400">({e.student?.rollNo})</span></span>
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">{TYPE_LABELS[e.enrollmentType]}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
