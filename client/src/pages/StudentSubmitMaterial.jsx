import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UploadCloud, X, FileIcon as FileIconLucide } from 'lucide-react';
import { courseApi, categoryApi, chapterApi, topicApi, semesterApi, fileApi, authApi } from '../api/endpoints.js';
import SearchableSelect from '../components/SearchableSelect.jsx';
import { UploadTypeToggle, ExternalUrlField, isValidHttpsUrl, UPLOAD_TYPE_FILE, UPLOAD_TYPE_EXTERNAL } from '../components/MaterialSource.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatBytes } from '../utils/format.js';

const initialState = {
  title: '',
  description: '',
  departmentId: '',
  courseIdRef: '',
  categoryId: '',
  chapterId: '',
  topicId: '',
  keywords: '',
  // '' = no semester filter (every reachable course, exactly as before). A
  // concrete value is a Semester.name and matches Course.semester.
  semester: '',
  visibility: 'login_required',
  uploadType: UPLOAD_TYPE_FILE,
  externalUrl: '',
};

const MAX_FILES = 10;

// Simplified upload form for students (and a "CR"-tier admin account acting
// as one) — no restriction/batch controls (those stay a reviewer decision).
// Everything submitted here lands as approvalStatus:'pending' and is invisible
// to everyone else until an Admin/Super Admin/Faculty reviewer approves it.
//
// Course options depend on BOTH the selected Department and the selected
// Semester: only courses that belong to the chosen semester are offered, and a
// course with a different (or no) semester is hidden once one is picked.
//
// Department/Course are NOT freely pickable — only courses the submitter can
// actually reach (via GET /courses/mine) are offered. The server enforces the
// same rules independently (fileController.js's submitStudentFile) — this is a
// UX convenience, not the real gate.
export default function StudentSubmitMaterial() {
  const [form, setForm] = useState(initialState);
  const [files, setFiles] = useState([]);
  const [progress, setProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: settings, isLoading: loadingSettings } = useQuery({ queryKey: ['public-settings'], queryFn: authApi.publicSettings });
  const enabled = !!settings?.data?.studentUploadEnabled;
  // Mirrors the server's own isBlockedByApproval() gate (courseAccessService.js,
  // enforced independently in submitStudentFile) — a pending/rejected
  // student can't submit material until an Admin approves their Student ID.
  const approvalBlocked = user?.role === 'student' && !!settings?.data?.studentApprovalEnabled && user?.approvalStatus !== 'approved';
  const isExternal = form.uploadType === UPLOAD_TYPE_EXTERNAL;

  const { data: myCourses } = useQuery({ queryKey: ['my-reachable-courses'], queryFn: courseApi.mine, enabled: enabled && !approvalBlocked });
  const allMyCourses = myCourses?.data || [];

  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list, enabled });

  // The user's own semester, resolved from the Semester collection: the cached
  // session user carries a bare ObjectId for `semester`, so its name is looked up
  // here (the same reason My Courses reads the profile for the populated names).
  const mySemesterId = user?.semester && typeof user.semester === 'object' ? user.semester._id : user?.semester;
  const userSemesterName = useMemo(() => {
    const match = (semesters?.data || []).find((s) => String(s._id) === String(mySemesterId));
    if (match?.name) return match.name;
    return typeof user?.semester === 'object' ? user.semester?.name || '' : '';
  }, [semesters, mySemesterId, user]);

  // Only the semesters that actually hold a course this user can reach, so the
  // picker can never offer an empty filter. Ordered by the Semester collection
  // (1st → 8th) where the labels line up with it.
  const semesterOptions = useMemo(() => {
    const names = new Set();
    for (const c of allMyCourses) {
      if (c.semester) names.add(c.semester);
    }
    const order = (semesters?.data || []).map((s) => s.name);
    return [...names].sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [allMyCourses, semesters]);

  // Scope the form to the user's own semester by default — the same "running"
  // courses My Courses shows — falling back to the first available semester, and
  // to no filter at all when none of the reachable courses declares one.
  useEffect(() => {
    if (!myCourses) return;
    setForm((f) => {
      if (f.semester && semesterOptions.includes(f.semester)) return f;
      const next = semesterOptions.includes(userSemesterName) ? userSemesterName : (semesterOptions[0] || '');
      return next === f.semester ? f : { ...f, semester: next, departmentId: '', courseIdRef: '', chapterId: '', topicId: '' };
    });
  }, [myCourses, semesterOptions, userSemesterName]);

  // Courses belonging to the selected semester. With no semester chosen this is
  // the full reachable set — the pre-existing behaviour, unchanged.
  const semesterCourses = useMemo(
    () => (form.semester ? allMyCourses.filter((c) => c.semester === form.semester) : allMyCourses),
    [allMyCourses, form.semester]
  );

  // Departments derived from the (semester-filtered) reachable course list, so
  // the Department dropdown never offers a department with no selectable course.
  const myDepartments = useMemo(() => {
    const byId = new Map();
    for (const c of semesterCourses) {
      if (c.department?._id) byId.set(c.department._id, c.department);
    }
    return [...byId.values()];
  }, [semesterCourses]);

  // Default the Department to the user's own when it has a course in the chosen
  // semester, so the form opens on their own scope rather than asking twice.
  const myDepartmentId = user?.department && typeof user.department === 'object' ? user.department._id : user?.department;
  useEffect(() => {
    if (!myCourses || form.departmentId) return;
    const own = myDepartments.find((d) => String(d._id) === String(myDepartmentId));
    const pick = own?._id || myDepartments[0]?._id || '';
    if (pick) setForm((f) => ({ ...f, departmentId: pick, courseIdRef: '', chapterId: '', topicId: '' }));
  }, [myCourses, myDepartments, myDepartmentId, form.departmentId]);

  const coursesInSelectedDept = useMemo(
    () => semesterCourses.filter((c) => String(c.department?._id) === String(form.departmentId)),
    [semesterCourses, form.departmentId]
  );

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: categoryApi.list, enabled });
  const { data: chapters } = useQuery({
    queryKey: ['chapters', form.courseIdRef],
    queryFn: () => chapterApi.list({ course: form.courseIdRef }),
    enabled: enabled && !!form.courseIdRef,
  });
  const { data: topics } = useQuery({
    queryKey: ['topics', form.chapterId],
    queryFn: () => topicApi.list({ chapter: form.chapterId }),
    enabled: enabled && !!form.chapterId,
  });

  const set = (key) => (val) => setForm((f) => ({ ...f, [key]: val }));

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

  const submit = async (e) => {
    e.preventDefault();
    if (isExternal) {
      if (!isValidHttpsUrl(form.externalUrl)) return toast('Enter a valid https:// link', 'error');
    } else if (!files.length) {
      return toast('Please select at least one file', 'error');
    }

    setSubmitting(true);
    setProgress(0);
    try {
      const fd = new FormData();
      if (!isExternal) files.forEach((f) => fd.append('files', f));
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      const res = await fileApi.submit(fd, (evt) => setProgress(Math.round((evt.loaded * 100) / evt.total)));
      toast(res.message || 'Submitted for review', 'success');
      setForm(initialState);
      setFiles([]);
    } catch (err) {
      toast(err.response?.data?.message || 'Submission failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingSettings) {
    return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-slate-400">Loading...</div>;
  }

  if (!enabled) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Material Submission Unavailable</h1>
        <p className="text-sm text-slate-500">
          The Student Material Upload system is currently turned off by the site administrators. Please check back
          later.
        </p>
      </div>
    );
  }

  if (approvalBlocked) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Submission Locked</h1>
        <p className="text-sm text-slate-500">
          Submit Material unlocks once an Admin approves your Student ID.
        </p>
      </div>
    );
  }

  if (myCourses && allMyCourses.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-slate-800 mb-2">No Courses Available</h1>
        <p className="text-sm text-slate-500">
          You don't have any department or enrolled course to submit material for yet. Make sure your Department is
          set on your Profile, or ask an Admin to enroll you in a course.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <h1 className="text-2xl font-bold text-slate-800 mb-1">Submit a Material</h1>
      <p className="text-sm text-slate-500 mb-6">
        Your submission will be reviewed by an Admin, Super Admin, or Faculty member before it becomes available to
        anyone else.
      </p>

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
        <Field label="How are you submitting this?">
          <UploadTypeToggle value={form.uploadType} onChange={set('uploadType')} />
        </Field>

        {isExternal ? (
          <ExternalUrlField value={form.externalUrl} onChange={set('externalUrl')} />
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

        <Field label="Title" hint="Leave blank to use the file name">
          <input value={form.title} onChange={(e) => set('title')(e.target.value)} className="input" placeholder="e.g. My Lecture Notes" />
        </Field>

        <Field label="Semester" hint="Only courses belonging to the selected semester are listed">
          <SearchableSelect
            value={form.semester}
            onChange={(v) => setForm((f) => ({ ...f, semester: v, departmentId: '', courseIdRef: '', chapterId: '', topicId: '' }))}
            placeholder="Select"
            searchPlaceholder="Search semesters..."
            options={semesterOptions.map((name) => ({ value: name, label: name }))}
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Department" required hint="Only departments you have a reachable course in are listed">
            <SearchableSelect
              required
              value={form.departmentId}
              onChange={(v) => setForm((f) => ({ ...f, departmentId: v, courseIdRef: '', chapterId: '', topicId: '' }))}
              placeholder="Select"
              searchPlaceholder="Search departments..."
              options={myDepartments.map((d) => ({ value: d._id, label: `${d.name} (${d.code})` }))}
            />
          </Field>
          <Field label="Course" required>
            <SearchableSelect
              required
              disabled={!form.departmentId}
              value={form.courseIdRef}
              onChange={(v) => setForm((f) => ({ ...f, courseIdRef: v, chapterId: '', topicId: '' }))}
              placeholder="Select"
              searchPlaceholder="Search courses..."
              options={coursesInSelectedDept.map((c) => ({ value: c._id, label: `${c.name} (${c.courseId})` }))}
            />
          </Field>
          <Field label="Material Type" required>
            <select value={form.categoryId} onChange={(e) => set('categoryId')(e.target.value)} className="input" required>
              <option value="">Select</option>
              {(categories?.data || []).map((c) => (
                <option key={c._id} value={c._id}>{c.name}</option>
              ))}
            </select>
          </Field>
        </div>

        {form.semester && semesterCourses.length === 0 && (
          <p className="text-sm text-amber-600">
            You don't have any reachable course in {form.semester}. Pick a different semester.
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Chapter">
            <select
              value={form.chapterId}
              onChange={(e) => { set('chapterId')(e.target.value); set('topicId')(''); }}
              className="input"
              disabled={!form.courseIdRef}
            >
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

        <Field label="Who can access this?">
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={form.visibility === 'public'} onChange={() => set('visibility')('public')} />
              Public (anyone, no login)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={form.visibility === 'login_required'} onChange={() => set('visibility')('login_required')} />
              Login required
            </label>
          </div>
        </Field>

        <Field label="Keywords (comma separated)">
          <input value={form.keywords} onChange={(e) => set('keywords')(e.target.value)} className="input" placeholder="graph theory, discrete mathematics" />
        </Field>

        <Field label="Description">
          <textarea value={form.description} onChange={(e) => set('description')(e.target.value)} rows={3} className="input" />
        </Field>

        <button disabled={submitting} className="w-full h-11 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-60">
          {submitting ? `Submitting... ${progress}%` : 'Submit for Review'}
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
