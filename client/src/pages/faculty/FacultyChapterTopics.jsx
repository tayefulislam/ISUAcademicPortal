import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { facultyApi, chapterApi, topicApi, authApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

// Faculty-facing, create-only Chapter/Topic tool — scoped to the faculty
// member's own assigned Department(s)/Course(s), gated by Super Admin's
// "Faculty: Create Chapter/Topic" toggle (Permissions page). Editing and
// deleting stay Super Admin-only (System Management).
export default function FacultyChapterTopics() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [course, setCourse] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [chapterName, setChapterName] = useState('');
  const [topicName, setTopicName] = useState('');

  const { data: settings, isLoading: loadingSettings } = useQuery({ queryKey: ['public-settings'], queryFn: authApi.publicSettings });
  const enabled = !!settings?.data?.facultyChapterTopicEnabled;

  const { data: facultyCourses } = useQuery({ queryKey: ['faculty-courses'], queryFn: facultyApi.courses, enabled });
  const { data: chapters } = useQuery({ queryKey: ['chapters', course], queryFn: () => chapterApi.list({ course }), enabled: enabled && !!course });

  const courses = facultyCourses?.data || [];
  const courseChapters = chapters?.data || [];

  const createChapter = async (e) => {
    e.preventDefault();
    try {
      await chapterApi.create({ name: chapterName, course });
      toast('Chapter created', 'success');
      setChapterName('');
      qc.invalidateQueries({ queryKey: ['chapters', course] });
    } catch (err) {
      toast(err.response?.data?.message || 'Create failed', 'error');
    }
  };

  const createTopic = async (e) => {
    e.preventDefault();
    try {
      await topicApi.create({ name: topicName, chapterId });
      toast('Topic created', 'success');
      setTopicName('');
      qc.invalidateQueries({ queryKey: ['topics'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Create failed', 'error');
    }
  };

  if (loadingSettings) return <p className="text-slate-400">Loading...</p>;

  if (!enabled) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Chapters & Topics</h1>
        <p className="text-slate-500">This feature is currently disabled by Super Admin.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Chapters & Topics</h1>
        <form onSubmit={createChapter} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-slate-700">New Chapter</h2>
          <select required value={course} onChange={(e) => { setCourse(e.target.value); setChapterId(''); }} className="input">
            <option value="">Select your course</option>
            {courses.map((c) => <option key={c._id} value={c._id}>{c.name} ({c.courseId})</option>)}
          </select>
          <input required value={chapterName} onChange={(e) => setChapterName(e.target.value)} placeholder="Chapter name" className="input" disabled={!course} />
          <button disabled={!course} className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
            <Plus size={16} /> Add Chapter
          </button>
          {!courses.length && <p className="text-xs text-amber-600">You have no assigned courses yet — ask Super Admin to assign one.</p>}
        </form>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-slate-800 mb-4 lg:invisible">.</h1>
        <form onSubmit={createTopic} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="font-semibold text-slate-700">New Topic</h2>
          <select required value={chapterId} onChange={(e) => setChapterId(e.target.value)} className="input" disabled={!course}>
            <option value="">Select a chapter</option>
            {courseChapters.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
          <input required value={topicName} onChange={(e) => setTopicName(e.target.value)} placeholder="Topic name" className="input" disabled={!chapterId} />
          <button disabled={!chapterId} className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
            <Plus size={16} /> Add Topic
          </button>
          {course && !courseChapters.length && <p className="text-xs text-slate-400">Add a chapter first.</p>}
        </form>
      </div>

      <style>{`.input { width: 100%; height: 2.5rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; }
      .input:disabled { background-color: #f1f5f9; color: #94a3b8; }`}</style>
    </div>
  );
}
