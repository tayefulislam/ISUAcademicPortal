import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, History, UploadCloud, FileIcon as FileIconLucide } from 'lucide-react';
import { departmentApi, batchApi, semesterApi, courseApi, adminApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { formatDate, formatBytes } from '../utils/format.js';

const MAX_REPLACE_FILES = 10;

// Shared by AdminFiles, SuperAdminFiles, and FacultyFiles. `api` defaults to
// adminApi (/admin/files/:id*, allowed for the file's own uploader or any
// super_admin) — pass `facultyApi` to hit /faculty/files/:id* instead, which
// the server allows for a Faculty member scoped to the file's department/course.
export default function EditFileModal({ file, onClose, invalidateKey, api = adminApi }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    title: file.title,
    description: file.description || '',
    semester: file.semester || '',
    academicYear: file.academicYear || '',
    status: file.status,
    visibility: file.visibility || 'login_required',
    restrictEnabled: !!(
      file.restrictions?.departments?.length ||
      file.restrictions?.batches?.length ||
      file.restrictions?.semesters?.length ||
      file.restrictions?.courses?.length
    ),
    restrictDepartments: (file.restrictions?.departments || []).map((d) => d._id || d),
    restrictBatches: (file.restrictions?.batches || []).map((b) => b._id || b),
    restrictSemesters: (file.restrictions?.semesters || []).map((s) => s._id || s),
    restrictCourses: (file.restrictions?.courses || []).map((c) => c._id || c),
  });
  const [saving, setSaving] = useState(false);
  const [replaceFiles, setReplaceFiles] = useState([]);
  const [replacing, setReplacing] = useState(false);
  const [replaceProgress, setReplaceProgress] = useState(0);
  const [replaceStatus, setReplaceStatus] = useState(''); // '' | 'uploading' | 'saving'
  const [versions, setVersions] = useState(null);
  // Reflects the modal's own header ("Current File" / "Version") without
  // waiting for the parent list's query to refetch — replaceVersion() below
  // updates this straight from the response the moment a replace succeeds.
  const [current, setCurrent] = useState({
    originalName: file.originalName,
    fileCount: file.fileCount || 1,
    fileSize: file.fileSize,
    currentVersion: file.currentVersion || 1,
  });

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });
  const { data: courses } = useQuery({ queryKey: ['all-courses'], queryFn: () => courseApi.list({ limit: 500 }) });

  useEffect(() => {
    api
      .getFileVersions(file._id)
      .then((res) => setVersions(res.data))
      .catch((err) => {
        toast(err.response?.data?.message || 'Could not load version history', 'error');
        setVersions({ versions: [], currentVersion: file.currentVersion || 1 });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file._id]);

  const toggleIn = (key) => (id) => {
    setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { restrictEnabled, ...rest } = form;
      await api.updateFile(file._id, {
        ...rest,
        restrictions: restrictEnabled
          ? {
              departments: form.restrictDepartments,
              batches: form.restrictBatches,
              semesters: form.restrictSemesters,
              courses: form.restrictCourses,
            }
          : { departments: [], batches: [], semesters: [], courses: [] },
      });
      toast('File updated', 'success');
      invalidateAllFileQueries(qc, invalidateKey, file._id);
      onClose();
    } catch (err) {
      toast(err.response?.data?.message || 'Update failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const addReplaceFiles = (fileList) => {
    const incoming = Array.from(fileList || []);
    if (!incoming.length) return;
    setReplaceFiles((prev) => {
      const existingKeys = new Set(prev.map((f) => `${f.name}_${f.size}`));
      const merged = [...prev];
      for (const f of incoming) {
        const key = `${f.name}_${f.size}`;
        if (!existingKeys.has(key)) {
          merged.push(f);
          existingKeys.add(key);
        }
      }
      return merged.slice(0, MAX_REPLACE_FILES);
    });
  };
  const removeReplaceFile = (idx) => setReplaceFiles((prev) => prev.filter((_, i) => i !== idx));

  const replaceVersion = async () => {
    if (!replaceFiles.length) return toast('Choose a replacement file first', 'error');
    setReplacing(true);
    setReplaceProgress(0);
    setReplaceStatus('uploading');
    try {
      const fd = new FormData();
      replaceFiles.forEach((f) => fd.append('files', f));
      const res = await api.replaceFileVersion(file._id, fd, (evt) => setReplaceProgress(Math.round((evt.loaded * 100) / evt.total)));
      setReplaceStatus('saving');
      const updated = res.data;
      setCurrent({
        originalName: updated.originalName,
        fileCount: updated.fileCount || 1,
        fileSize: updated.fileSize,
        currentVersion: updated.currentVersion,
      });
      toast(`New version uploaded — now v${updated.currentVersion}`, 'success');
      const versionsRes = await api.getFileVersions(file._id);
      setVersions(versionsRes.data);
      setReplaceFiles([]);
      invalidateAllFileQueries(qc, invalidateKey, file._id);
    } catch (err) {
      toast(err.response?.data?.message || 'Replace failed', 'error');
    } finally {
      setReplacing(false);
      setReplaceStatus('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800">Edit Material</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-4 text-sm">
          <span className="flex items-center gap-2 min-w-0 text-slate-700">
            <FileIconLucide size={15} className="text-slate-400 shrink-0" />
            <span className="truncate font-medium">
              {current.originalName} {current.fileCount > 1 && `(+${current.fileCount - 1} more)`}
            </span>
            <span className="text-xs text-slate-400 shrink-0">{formatBytes(current.fileSize)}</span>
          </span>
          <span className="shrink-0 text-xs font-semibold text-brand-700 bg-brand-50 border border-brand-200 rounded-full px-2 py-0.5">
            v{current.currentVersion}
          </span>
        </div>

        <form onSubmit={save} className="space-y-4">
          <Field label="Title">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="input" required />
          </Field>
          <Field label="Description">
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="input" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Semester">
              <input value={form.semester} onChange={(e) => setForm({ ...form, semester: e.target.value })} className="input" />
            </Field>
            <Field label="Academic Year">
              <input value={form.academicYear} onChange={(e) => setForm({ ...form, academicYear: e.target.value })} className="input" />
            </Field>
          </div>
          <Field label="Status">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input">
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </Field>

          <Field label="Visibility">
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={form.visibility === 'public'} onChange={() => setForm({ ...form, visibility: 'public' })} />
                Public
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={form.visibility === 'login_required'} onChange={() => setForm({ ...form, visibility: 'login_required' })} />
                Login required
              </label>
            </div>
          </Field>

          <Field label="Restrict to specific students">
            <label className="flex items-center gap-2 text-sm mb-2">
              <input
                type="checkbox"
                checked={form.restrictEnabled}
                onChange={(e) => setForm((f) => ({ ...f, restrictEnabled: e.target.checked }))}
              />
              Only students matching these criteria can access this material
            </label>
            {form.restrictEnabled && (
              <div className="space-y-3 border border-slate-200 rounded-lg p-3">
                <RestrictGroup label="Department" items={departments?.data} value={form.restrictDepartments} onToggle={toggleIn('restrictDepartments')} />
                <RestrictGroup label="Batch" items={batches?.data} value={form.restrictBatches} onToggle={toggleIn('restrictBatches')} />
                <RestrictGroup label="Semester" items={semesters?.data} value={form.restrictSemesters} onToggle={toggleIn('restrictSemesters')} />
                <RestrictGroup label="Course" items={courses?.data} value={form.restrictCourses} onToggle={toggleIn('restrictCourses')} labelKey="courseId" />
              </div>
            )}
          </Field>

          <button disabled={saving} className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold disabled:opacity-60">
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-slate-200">
          <p className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5"><UploadCloud size={15} /> Replace file (new version)</p>

          <label
            className="block border-2 border-dashed border-slate-300 rounded-xl p-6 text-center cursor-pointer hover:border-brand-400"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              addReplaceFiles(e.dataTransfer.files);
            }}
          >
            <input type="file" multiple className="hidden" onChange={(e) => addReplaceFiles(e.target.files)} disabled={replacing} />
            <UploadCloud className="mx-auto text-slate-400 mb-2" size={26} />
            <p className="text-sm text-slate-600">
              {replaceFiles.length ? `${replaceFiles.length} file(s) selected — click to add more` : 'Click to choose a file, or drag and drop'}
            </p>
            <p className="text-xs text-slate-400 mt-1">Up to {MAX_REPLACE_FILES} files &middot; replaces the current version</p>
          </label>

          {replaceFiles.length > 0 && (
            <ul className="space-y-1.5 mt-2">
              {replaceFiles.map((f, idx) => (
                <li key={`${f.name}_${f.size}`} className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    <FileIconLucide size={16} className="text-slate-400 shrink-0" />
                    <span className="truncate">{f.name}</span>
                    <span className="text-xs text-slate-400 shrink-0">{formatBytes(f.size)}</span>
                  </span>
                  <button type="button" onClick={() => removeReplaceFile(idx)} disabled={replacing} className="text-slate-400 hover:text-red-600 shrink-0">
                    <X size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {replacing && (
            <div className="w-full bg-slate-100 rounded-full h-2 mt-2">
              <div className="bg-brand-600 h-2 rounded-full transition-all" style={{ width: `${replaceProgress}%` }} />
            </div>
          )}

          <button
            type="button"
            onClick={replaceVersion}
            disabled={replacing || !replaceFiles.length}
            className="h-9 px-4 rounded-lg bg-slate-800 text-white text-sm font-medium disabled:opacity-50 mt-2"
          >
            {replaceStatus === 'uploading' && `Uploading... ${replaceProgress}%`}
            {replaceStatus === 'saving' && 'Saving...'}
            {!replaceStatus && 'Upload new version'}
          </button>
        </div>

        <div className="mt-6 pt-4 border-t border-slate-200">
          <p className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1.5"><History size={15} /> Version history</p>
          {!versions ? (
            <p className="text-xs text-slate-400">Loading...</p>
          ) : !versions.versions?.length ? (
            <p className="text-xs text-slate-400">No previous versions — this is the original upload (v{current.currentVersion}).</p>
          ) : (
            <ul className="space-y-2">
              {versions.versions
                .slice()
                .reverse()
                .map((v, i) => (
                  <li key={i} className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2.5">
                    <p className="font-medium text-slate-700">
                      v{v.versionNumber} &middot; {v.title} &middot; {formatBytes(v.fileSize)}
                    </p>
                    <p className="text-slate-400 mt-0.5">Replaced {formatDate(v.replacedAt)}</p>
                  </li>
                ))}
              <li className="text-xs bg-brand-50 border border-brand-200 rounded-lg p-2.5">
                <p className="font-medium text-brand-700">v{current.currentVersion} &middot; current</p>
              </li>
            </ul>
          )}
        </div>
      </div>

      <style>{`.input { width: 100%; height: 2.5rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; }
      textarea.input { height: auto; padding: 0.5rem 0.75rem; }`}</style>
    </div>
  );
}

// Replacing a file's content/metadata changes what every one of these views
// would show — invalidateKey (the parent list's own query key, e.g.
// 'admin-my-files') alone leaves the public detail page, home page, and
// search results stale until a hard refresh. Keys match the actual
// useQuery calls elsewhere (FileDetails.jsx's ['file', id]/['related', id],
// Home.jsx's ['recent']/['popular'], Dashboard.jsx's ['dashboard'],
// SearchResults.jsx's ['search', queryParams] — TanStack Query's default
// partial-match invalidation covers that last one from just ['search']).
function invalidateAllFileQueries(qc, invalidateKey, fileId) {
  qc.invalidateQueries({ queryKey: [invalidateKey] });
  qc.invalidateQueries({ queryKey: ['file', fileId] });
  qc.invalidateQueries({ queryKey: ['related', fileId] });
  qc.invalidateQueries({ queryKey: ['recent'] });
  qc.invalidateQueries({ queryKey: ['popular'] });
  qc.invalidateQueries({ queryKey: ['dashboard'] });
  qc.invalidateQueries({ queryKey: ['search'] });
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
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
            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
              value.includes(item._id) ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-300 text-slate-600'
            }`}
          >
            {item[labelKey] || item.name}
          </button>
        ))}
        {!items?.length && <span className="text-xs text-slate-400">None available</span>}
      </div>
    </div>
  );
}
