import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Building2, BookOpen, Users2, Files, TrendingUp, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import SearchBar from '../components/SearchBar.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';
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
      {/* No z-index/stacking context on this section itself — giving the whole
          hero a higher stacking context than the stats section below made its
          blue gradient background paint over the stats cards' overlap area.
          Instead only the form (which holds the dropdowns) is raised above
          the stats section's z-10, via z-30 below, since without a
          stacking-context ancestor that z-index is compared directly against
          the stats section's in the shared root stacking context. */}
      <section className="bg-gradient-to-b from-brand-600 to-brand-700 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight">Find every academic file, instantly.</h1>
          <p className="mt-4 text-brand-100 text-base sm:text-lg max-w-2xl mx-auto">
            Lecture notes, assignments, question papers, and more — organized by department, course, and batch.
          </p>

          <div className="mt-8 max-w-2xl mx-auto">
            <SearchBar />
          </div>

          <form onSubmit={goSearch} className="relative z-30 mt-6 bg-white/10 backdrop-blur rounded-xl p-3 flex flex-col sm:flex-row gap-2 max-w-3xl mx-auto">
            <SearchableSelect
              className="flex-1"
              value={dept}
              onChange={(v) => { setDept(v); setCourse(''); }}
              placeholder="Select Department"
              searchPlaceholder="Search departments..."
              options={(departments?.data || []).map((d) => ({ value: d._id, label: `${d.name} (${d.code})` }))}
            />
            <SearchableSelect
              className="flex-1"
              value={course}
              onChange={setCourse}
              placeholder="Select Course"
              searchPlaceholder="Search courses..."
              options={(courses?.data || []).map((c) => ({ value: c._id, label: `${c.name} (${c.courseId})` }))}
            />
            <SearchableSelect
              className="flex-1"
              value={batch}
              onChange={setBatch}
              placeholder="Select Batch"
              searchPlaceholder="Search batches..."
              options={(batches?.data || []).map((b) => ({ value: b.code, label: b.name }))}
            />
            <button type="submit" className="h-12 sm:h-11 px-6 rounded-lg bg-white text-brand-700 font-semibold hover:bg-brand-50">
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
