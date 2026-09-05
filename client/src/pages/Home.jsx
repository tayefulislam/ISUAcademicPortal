import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Building2, BookOpen, Users2, Files, TrendingUp, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import SearchBar from '../components/SearchBar.jsx';
import StatCard from '../components/StatCard.jsx';
import FileCard from '../components/FileCard.jsx';
import FileGridSkeleton from '../components/FileGridSkeleton.jsx';
import { fileApi, departmentApi, courseApi, batchApi } from '../api/endpoints.js';
import { useDownloadFile } from '../hooks/useDownloadFile.js';
import { trackEvent } from '../utils/analytics.js';

export default function Home() {
  const navigate = useNavigate();
  const download = useDownloadFile();
  const [dept, setDept] = useState('');
  const [course, setCourse] = useState('');
  const [batch, setBatch] = useState('');

  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: fileApi.stats });
  const { data: recent, isLoading: loadingRecent } = useQuery({ queryKey: ['recent'], queryFn: () => fileApi.recent(6) });
  const { data: popular, isLoading: loadingPopular } = useQuery({ queryKey: ['popular'], queryFn: () => fileApi.popular(6) });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data: courses } = useQuery({ queryKey: ['courses', dept], queryFn: () => courseApi.list({ department: dept, limit: 200 }) });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });

  useEffect(() => {
    trackEvent('page_view', { page_path: '/' });
  }, []);

  const goSearch = (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (dept) params.set('department', dept);
    if (course) params.set('course', course);
    if (batch) params.set('batch', batch);
    navigate(`/search?${params.toString()}`);
  };

  return (
    <div>
      <section className="bg-gradient-to-b from-brand-600 to-brand-700 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight">Find every academic file, instantly.</h1>
          <p className="mt-4 text-brand-100 text-base sm:text-lg max-w-2xl mx-auto">
            Lecture notes, assignments, question papers, and more — organized by department, course, and batch.
          </p>

          <div className="mt-8 max-w-2xl mx-auto">
            <SearchBar />
          </div>

          <form onSubmit={goSearch} className="mt-6 bg-white/10 backdrop-blur rounded-xl p-3 flex flex-col sm:flex-row gap-2 max-w-3xl mx-auto">
            <select value={dept} onChange={(e) => { setDept(e.target.value); setCourse(''); }} className="flex-1 h-11 rounded-lg px-3 text-sm text-slate-800">
              <option value="">Select Department</option>
              {(departments?.data || []).map((d) => (
                <option key={d._id} value={d._id}>{d.name} ({d.code})</option>
              ))}
            </select>
            <select value={course} onChange={(e) => setCourse(e.target.value)} className="flex-1 h-11 rounded-lg px-3 text-sm text-slate-800">
              <option value="">Select Course</option>
              {(courses?.data || []).map((c) => (
                <option key={c._id} value={c._id}>{c.name} ({c.courseId})</option>
              ))}
            </select>
            <select value={batch} onChange={(e) => setBatch(e.target.value)} className="flex-1 h-11 rounded-lg px-3 text-sm text-slate-800">
              <option value="">Select Batch</option>
              {(batches?.data || []).map((b) => (
                <option key={b._id} value={b.code}>{b.name}</option>
              ))}
            </select>
            <button type="submit" className="h-11 px-6 rounded-lg bg-white text-brand-700 font-semibold hover:bg-brand-50">
              Browse Files
            </button>
          </form>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 -mt-8 relative z-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Departments" value={stats?.data?.departments ?? '-'} icon={Building2} />
          <StatCard label="Courses" value={stats?.data?.courses ?? '-'} icon={BookOpen} />
          <StatCard label="Batches" value={stats?.data?.batches ?? '-'} icon={Users2} />
          <StatCard label="Files" value={stats?.data?.files ?? '-'} icon={Files} />
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="text-brand-600" size={20} />
          <h2 className="text-xl font-bold text-slate-800">Recent Files</h2>
        </div>
        {loadingRecent ? (
          <FileGridSkeleton count={3} />
        ) : recent?.data?.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {recent.data.map((f) => (
              <FileCard key={f._id} file={f} onDownload={download} />
            ))}
          </div>
        ) : (
          <p className="text-slate-400">No files uploaded yet.</p>
        )}
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 pb-16">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="text-brand-600" size={20} />
          <h2 className="text-xl font-bold text-slate-800">Popular Files</h2>
        </div>
        {loadingPopular ? (
          <FileGridSkeleton count={3} />
        ) : popular?.data?.length ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {popular.data.map((f) => (
              <FileCard key={f._id} file={f} onDownload={download} />
            ))}
          </div>
        ) : (
          <p className="text-slate-400">No activity yet.</p>
        )}
      </section>
    </div>
  );
}
