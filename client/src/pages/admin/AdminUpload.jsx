import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UploadCloud, X, FileIcon as FileIconLucide, CloudUpload, HardDrive } from 'lucide-react';
import { FileUploaderRegular } from '@uploadcare/react-uploader';
import '@uploadcare/react-uploader/core.css';
import { departmentApi, courseApi, batchApi, categoryApi, fileApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatBytes } from '../../utils/format.js';

const UPLOADCARE_PUBKEY = import.meta.env.VITE_UPLOADCARE_PUBLIC_KEY;

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

const MAX_FILES = 10;

export default function AdminUpload() {
  const [mode, setMode] = useState('direct'); // 'direct' | 'uploadcare'
  const [form, setForm] = useState(initialState);
  const [files, setFiles] = useState([]);
  const [ucFiles, setUcFiles] = useState([]);
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const uploaderRef = useRef(null);
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

  const addFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;

    setFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}_${f.size}`));
      const merged = [...prev];
      for (const f of incoming) {
        const key = `${f.name}_${f.size}`;
        if (!existingKeys.has(key)) {
          merged.push(f);
          existingKeys.add(key);
        }
      }
      if (merged.length > MAX_FILES) {
        toast(`You can upload up to ${MAX_FILES} files at once`, 'error');
        return merged.slice(0, MAX_FILES);
      }
      return merged;
    });
  };

  const removeFile = (idx) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const reportSuccess = (res) => {
    const count = res.data?.fileCount || 1;
    toast(
      count > 1 ? `Uploaded — ${count} files grouped under "${res.data.title}"` : 'File uploaded successfully',
      'success'
    );
    if (res.failed?.length) {
      toast(`${res.failed.length} file(s) failed to upload`, 'error');
    }
    setForm(initialState);
    setFiles([]);
    setUcFiles([]);
    uploaderRef.current?.api?.removeAllFiles?.();
  };

  const submitDirect = async () => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    Object.entries(form).forEach(([k, v]) => {
      if (k === 'batches') v.forEach((b) => fd.append('batches', b));
      else fd.append(k, v);
    });
    return fileApi.upload(fd, (evt) => setProgress(Math.round((evt.loaded * 100) / evt.total)));
  };

  const submitUploadcare = () =>
    fileApi.attachUploadcare({
      ...form,
      files: ucFiles.map((f) => ({ uuid: f.uuid, name: f.name, size: f.size, mimeType: f.mimeType, isImage: f.isImage })),
    });

  const submit = async (e) => {
    e.preventDefault();
    if (mode === 'direct' && !files.length) return toast('Please select at least one file or image', 'error');
    if (mode === 'uploadcare' && !ucFiles.length) return toast('Please upload at least one file first', 'error');

    setSubmitting(true);
    setProgress(0);
    try {
      const res = mode === 'direct' ? await submitDirect() : await submitUploadcare();
      reportSuccess(res);
    } catch (err) {
      toast(err.response?.data?.message || 'Upload failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Upload Files</h1>

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        {UPLOADCARE_PUBKEY && (
          <div className="flex gap-2 p-1 bg-slate-100 rounded-lg w-fit">
            <button
              type="button"
              onClick={() => setMode('direct')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${
                mode === 'direct' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'
              }`}
            >
              <HardDrive size={15} /> Direct upload
            </button>
            <button
              type="button"
              onClick={() => setMode('uploadcare')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium ${
                mode === 'uploadcare' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'
              }`}
            >
              <CloudUpload size={15} /> Uploadcare (cloud sources)
            </button>
          </div>
        )}

        {mode === 'uploadcare' && UPLOADCARE_PUBKEY ? (
          <div>
            <FileUploaderRegular
              apiRef={uploaderRef}
              pubkey={UPLOADCARE_PUBKEY}
              multiple
              sourceList="local, url, camera, dropbox, gdrive, gphotos"
              classNameUploader="uc-light"
              onCommonUploadSuccess={(e) =>
                setUcFiles(
                  e.successEntries.map((entry) => ({
                    uuid: entry.uuid,
                    name: entry.name,
                    size: entry.size,
                    mimeType: entry.mimeType,
                    isImage: entry.isImage,
                  }))
                )
              }
            />
            <p className="text-xs text-slate-400 mt-2">
              Drag &amp; drop, pick from your device, paste a URL, use the camera, or import from Dropbox / Google
              Drive / Google Photos. Files upload straight to Uploadcare's CDN — up to {MAX_FILES} at once.
            </p>
            {ucFiles.length > 0 && (
              <p className="text-sm text-brand-700 font-medium mt-2">{ucFiles.length} file(s) ready to attach</p>
            )}
          </div>
        ) : (
          <>
            <label
              className="block border-2 border-dashed border-slate-300 rounded-xl p-8 text-center cursor-pointer hover:border-brand-400"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                addFiles(e.dataTransfer.files);
              }}
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
                    <button type="button" onClick={() => removeFile(idx)} className="text-slate-400 hover:text-red-600 shrink-0">
                      <X size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {submitting && (
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div className="bg-brand-600 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}

        <Field
          label="Title"
          hint={
            (mode === 'direct' ? files.length : ucFiles.length) > 1
              ? `All ${mode === 'direct' ? files.length : ucFiles.length} files will be grouped under this one title as a single entry`
              : 'Leave blank to use the file name'
          }
        >
          <input
            value={form.title}
            onChange={(e) => set('title')(e.target.value)}
            className="input"
            placeholder="e.g. Discrete Mathematics Lecture 05"
          />
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
          {submitting
            ? mode === 'direct'
              ? `Uploading... ${progress}%`
              : 'Saving...'
            : (mode === 'direct' ? files.length : ucFiles.length) > 1
            ? `Upload ${mode === 'direct' ? files.length : ucFiles.length} Files`
            : 'Upload File'}
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
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}
