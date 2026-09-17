import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { UploadCloud, X, FileIcon as FileIconLucide, ArrowLeft } from 'lucide-react';
import { facultyApi, batchApi, categoryApi, chapterApi, topicApi, semesterApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatBytes } from '../../utils/format.js';

const initialState = {
  title: '',
  description: '',
  courseIdRef: '',
  categoryId: '',
  chapterId: '',
  topicId: '',
  semester: '',
  academicYear: '',
  keywords: '',
  allBatches: false,
  batches: [],
  visibility: 'login_required',
  restrictEnabled: false,
  restrictDepartments: [],
  restrictBatches: [],
  restrictSemesters: [],
  restrictCourses: [],
};

const MAX_FILES = 10;

/**
 * The form's starting state. When the page is opened from a course page the
 * course (and usually a batch) are already known, so they are pre-filled and the
 * faculty member is only asked for what the system cannot know.
 */
function buildInitialForm(presetCourse, presetBatch) {
  return {
    ...initialState,
    courseIdRef: presetCourse,
    batches: presetBatch ? [presetBatch] : [],
    // Material uploaded for one batch must actually be limited to it. `batches`
    // alone is a grouping/filter field; it is `restrictions.batches` that the
    // server checks when deciding who may open the file, so a batch-scoped
    // upload sets both.
    ...(presetBatch ? { restrictEnabled: true, restrictBatches: [presetBatch] } : {}),
  };
}

// Faculty upload — same shape as AdminUpload, but the Course picker is
// limited to this Faculty member's own assigned courses (department is
// derived from the chosen course, not picked separately), and it posts to
// /faculty/files, which the server re-validates against their assignment.
export default function FacultyUpload() {
  // Arriving from a course page carries ?course=&batch= — everything the system
  // already knows, so the faculty member is not asked for the department or the
  // course again (the department is derived from the course below).
  const [searchParams] = useSearchParams();
  const presetCourse = searchParams.get('course') || '';
  const presetBatch = searchParams.get('batch') || '';

  const [form, setForm] = useState(() => buildInitialForm(presetCourse, presetBatch));
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const { data: myCourses } = useQuery({ queryKey: ['faculty-courses'], queryFn: facultyApi.courses });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: categoryApi.list });
  const { data: chapters } = useQuery({
    queryKey: ['chapters', form.courseIdRef],
    queryFn: () => chapterApi.list({ course: form.courseIdRef }),
    enabled: !!form.courseIdRef,
  });
  const { data: topics } = useQuery({
    queryKey: ['topics', form.chapterId],
    queryFn: () => topicApi.list({ chapter: form.chapterId }),
    enabled: !!form.chapterId,
  });
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });

  const selectedCourse = (myCourses?.data || []).find((c) => c._id === form.courseIdRef);

  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));
  const toggleBatch = (id) => setForm((f) => ({ ...f, batches: f.batches.includes(id) ? f.batches.filter((b) => b !== id) : [...f.batches, id] }));
  const toggleIn = (key) => (id) => setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}_${f.size}`));
      const merged = [...prev];
      for (const f of incoming) {
        const key = `${f.name}_${f.size}`;
        if (!existingKeys.has(key)) { merged.push(f); existingKeys.add(key); }
      }
      if (merged.length > MAX_FILES) {
        toast(`You can upload up to ${MAX_FILES} files at once`, 'error');
        return merged.slice(0, MAX_FILES);
      }
      return merged;
    });
  };
  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const submit = async (e) => {
    e.preventDefault();
    if (!files.length) return toast('Please select at least one file or image', 'error');
    if (!selectedCourse) return toast('Please select a course', 'error');

    setSubmitting(true);
    setProgress(0);
    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      fd.append('departmentId', selectedCourse.department._id);
      Object.entries(form).forEach(([k, v]) => {
        if (k === 'restrictEnabled') return;
        if (Array.isArray(v)) v.forEach((item) => fd.append(k, item));
        else fd.append(k, v);
      });
      const res = await facultyApi.upload(fd, (evt) => setProgress(Math.round((evt.loaded * 100) / evt.total)));
      toast(res.data?.fileCount > 1 ? `Uploaded — ${res.data.fileCount} files grouped under "${res.data.title}"` : 'File uploaded successfully', 'success');
      setForm(buildInitialForm(presetCourse, presetBatch));
      setFiles([]);
    } catch (err) {
      toast(err.response?.data?.message || 'Upload failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl">
      {presetCourse && (
        <Link
          to={`/courses/${presetCourse}${presetBatch ? `?batch=${presetBatch}` : ''}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3"
        >
          <ArrowLeft size={15} /> Back to {selectedCourse ? selectedCourse.name : 'course'}
        </Link>
      )}
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Upload Material</h1>

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <label
          className="block border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-brand-400"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
        >
          <input type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
          <UploadCloud className="mx-auto text-slate-400 mb-2" size={32} />
          <p className="text-sm text-slate-600">
            {files.length ? `${files.length} file(s) selected — click to add more` : 'Click to choose files/images, or drag and drop'}
          </p>
          <p className="text-xs text-slate-400 mt-1">PDF, images, DOC, PPT, XLS, TXT, ZIP &middot; up to {MAX_FILES} at once</p>
        </label>

        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map((f, idx) => (
              <li key={`${f.name}_${f.size}`} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                <span className="flex items-center gap-2 min-w-0">
                  <FileIconLucide size={16} className="text-slate-400 shrink-0" />
                  <span className="truncate">{f.name}</span>
                  <span className="text-xs text-slate-400 shrink-0">{formatBytes(f.size)}</span>
                </span>
                <button type="button" onClick={() => removeFile(idx)} className="text-slate-400 hover:text-red-600 shrink-0"><X size={16} /></button>
              </li>
            ))}
          </ul>
        )}

        {submitting && (
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div className="bg-brand-600 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}

        <Field label="Title" hint="Leave blank to use the file name">
          <input value={form.title} onChange={(e) => set('title')(e.target.value)} className="input" placeholder="e.g. Discrete Mathematics Lecture 05" />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Course" required hint={presetCourse ? 'Chosen on the course page — the department comes with it.' : undefined}>
            {presetCourse ? (
              // Already known, so never asked for again — and the department is
              // derived from it server-side too.
              <div className="input flex items-center bg-slate-50 text-slate-600">
                {selectedCourse
                  ? `${selectedCourse.name} (${selectedCourse.courseId}) — ${selectedCourse.department?.code}`
                  : 'Loading course…'}
              </div>
            ) : (
              <select
                value={form.courseIdRef}
                onChange={(e) => setForm((f) => ({ ...f, courseIdRef: e.target.value, chapterId: '', topicId: '' }))}
                className="input"
                required
              >
                <option value="">Select</option>
                {(myCourses?.data || []).map((c) => (
                  <option key={c._id} value={c._id}>{c.name} ({c.courseId}) — {c.department.code}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Material Type" required>
            <select value={form.categoryId} onChange={(e) => set('categoryId')(e.target.value)} className="input" required>
              <option value="">Select</option>
              {(categories?.data || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Chapter">
            <select value={form.chapterId} onChange={(e) => { set('chapterId')(e.target.value); set('topicId')(''); }} className="input" disabled={!form.courseIdRef}>
              <option value="">None</option>
              {(chapters?.data || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Topic">
            <select value={form.topicId} onChange={(e) => set('topicId')(e.target.value)} className="input" disabled={!form.chapterId}>
              <option value="">None</option>
              {(topics?.data || []).map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Semester">
            <select value={form.semester} onChange={(e) => set('semester')(e.target.value)} className="input">
              <option value="">Select semester</option>
              {(semesters?.data || []).map((s) => <option key={s._id} value={s.name}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Academic Year">
            <input value={form.academicYear} onChange={(e) => set('academicYear')(e.target.value)} className="input" placeholder="e.g. 2026" />
          </Field>
        </div>

        <Field label="Visibility">
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={form.visibility === 'public'} onChange={() => set('visibility')('public')} /> Public (anyone, no login)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={form.visibility === 'login_required'} onChange={() => set('visibility')('login_required')} /> Login required
            </label>
          </div>
        </Field>

        <Field label="Restrict to specific students">
          <label className="flex items-center gap-2 text-sm mb-2">
            <input
              type="checkbox"
              checked={form.restrictEnabled}
              onChange={(e) => setForm((f) => ({ ...f, restrictEnabled: e.target.checked, ...(e.target.checked ? {} : { restrictDepartments: [], restrictBatches: [], restrictSemesters: [], restrictCourses: [] }) }))}
            />
            Only students matching these criteria can access this material
          </label>
          {form.restrictEnabled && (
            <div className="space-y-3 border border-slate-200 rounded-lg p-3">
              <RestrictGroup label="Batch" items={batches?.data} value={form.restrictBatches} onToggle={toggleIn('restrictBatches')} />
              <RestrictGroup label="Semester" items={semesters?.data} value={form.restrictSemesters} onToggle={toggleIn('restrictSemesters')} />
            </div>
          )}
        </Field>

        <Field label="Batches">
          <label className="flex items-center gap-2 text-sm mb-2">
            <input type="checkbox" checked={form.allBatches} onChange={(e) => set('allBatches')(e.target.checked)} />
            Available to all batches
          </label>
          {!form.allBatches && (
            <div className="flex flex-wrap gap-2">
              {(batches?.data || []).map((b) => (
                <button
                  type="button"
                  key={b._id}
                  onClick={() => toggleBatch(b._id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border ${form.batches.includes(b._id) ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-300 text-slate-600'}`}
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field label="Keywords (comma separated)">
          <input value={form.keywords} onChange={(e) => set('keywords')(e.target.value)} className="input" placeholder="graph theory, discrete mathematics" />
        </Field>

        <Field label="Description">
          <textarea value={form.description} onChange={(e) => set('description')(e.target.value)} rows={3} className="input" />
        </Field>

        <button disabled={submitting} className="w-full h-11 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-60">
          {submitting ? `Uploading... ${progress}%` : files.length > 1 ? `Upload ${files.length} Files` : 'Upload File'}
        </button>
      </form>

      <style>{`.input { width: 100%; height: 2.75rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; }
      textarea.input { height: auto; padding: 0.6rem 0.75rem; }
      .input:focus { outline: none; box-shadow: 0 0 0 2px #3a66f5; border-color: transparent; }
      .input:disabled { background-color: #f1f5f9; color: #94a3b8; }`}</style>
    </div>
  );
}

function Field({ label, required, hint, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label} {required && <span className="text-red-500">*</span>}</label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function RestrictGroup({ label, items, value, onToggle, labelKey = 'name' }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-2">
        {(items || []).map((item) => (
          <button
            type="button"
            key={item._id}
            onClick={() => onToggle(item._id)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${value.includes(item._id) ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-300 text-slate-600'}`}
          >
            {item[labelKey] || item.name}
          </button>
        ))}
        {!items?.length && <span className="text-xs text-slate-400">None available</span>}
      </div>
    </div>
  );
}
