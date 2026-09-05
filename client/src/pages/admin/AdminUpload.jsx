import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UploadCloud } from 'lucide-react';
import { departmentApi, courseApi, batchApi, categoryApi, fileApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

const initialState = {
  title: '',
  description: '',
  departmentId: '',
  courseIdRef: '',
  categoryId: '',
  semester: '',
  academicYear: '',
  keywords: '',
  allBatches: false,
  batches: [],
};

export default function AdminUpload() {
  const [form, setForm] = useState(initialState);
  const [file, setFile] = useState(null);
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data: courses } = useQuery({
    queryKey: ['courses', form.departmentId],
    queryFn: () => courseApi.list({ department: form.departmentId, limit: 200 }),
    enabled: !!form.departmentId,
  });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: categoryApi.list });

  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

  const toggleBatch = (id) => {
    setForm((f) => ({
      ...f,
      batches: f.batches.includes(id) ? f.batches.filter((b) => b !== id) : [...f.batches, id],
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return toast('Please select a file', 'error');

    const fd = new FormData();
    fd.append('file', file);
    Object.entries(form).forEach(([k, v]) => {
      if (k === 'batches') v.forEach((b) => fd.append('batches', b));
      else fd.append(k, v);
    });

    setSubmitting(true);
    setProgress(0);
    try {
      await fileApi.upload(fd, (evt) => setProgress(Math.round((evt.loaded * 100) / evt.total)));
      toast('File uploaded successfully', 'success');
      setForm(initialState);
      setFile(null);
    } catch (err) {
      toast(err.response?.data?.message || 'Upload failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Upload File</h1>

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <label className="block border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-brand-400">
          <input type="file" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <UploadCloud className="mx-auto text-slate-400 mb-2" size={32} />
          <p className="text-sm text-slate-600">{file ? file.name : 'Click to choose a file, or drag and drop'}</p>
          <p className="text-xs text-slate-400 mt-1">PDF, images, DOC, PPT, XLS, TXT, ZIP</p>
        </label>

        {submitting && (
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div className="bg-brand-600 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}

        <Field label="Title">
          <input value={form.title} onChange={(e) => set('title')(e.target.value)} className="input" placeholder="e.g. Discrete Mathematics Lecture 05" />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Department" required>
            <select value={form.departmentId} onChange={(e) => { set('departmentId')(e.target.value); set('courseIdRef')(''); }} className="input" required>
              <option value="">Select</option>
              {(departments?.data || []).map((d) => (
                <option key={d._id} value={d._id}>{d.name} ({d.code})</option>
              ))}
            </select>
          </Field>
          <Field label="Course" required>
            <select value={form.courseIdRef} onChange={(e) => set('courseIdRef')(e.target.value)} className="input" required disabled={!form.departmentId}>
              <option value="">Select</option>
              {(courses?.data || []).map((c) => (
                <option key={c._id} value={c._id}>{c.name} ({c.courseId})</option>
              ))}
            </select>
          </Field>
          <Field label="Category" required>
            <select value={form.categoryId} onChange={(e) => set('categoryId')(e.target.value)} className="input" required>
              <option value="">Select</option>
              {(categories?.data || []).map((c) => (
                <option key={c._id} value={c._id}>{c.name}</option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Semester">
            <input value={form.semester} onChange={(e) => set('semester')(e.target.value)} className="input" placeholder="e.g. 3rd Semester" />
          </Field>
          <Field label="Academic Year">
            <input value={form.academicYear} onChange={(e) => set('academicYear')(e.target.value)} className="input" placeholder="e.g. 2026" />
          </Field>
        </div>

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
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                    form.batches.includes(b._id) ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-300 text-slate-600'
                  }`}
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
          {submitting ? `Uploading... ${progress}%` : 'Upload File'}
        </button>
      </form>

      <style>{`.input { width: 100%; height: 2.75rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; }
      textarea.input { height: auto; padding: 0.6rem 0.75rem; }
      .input:focus { outline: none; box-shadow: 0 0 0 2px #3a66f5; border-color: transparent; }`}</style>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}
