import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Upload } from 'lucide-react';
import { adminDocumentApi, documentCategoryApi, departmentApi, courseApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import usePanelBase from '../../hooks/usePanelBase.js';

const EMPTY = {
  name: '',
  category: '',
  description: '',
  departmentIds: [],
  courseId: '',
  availableFor: ['student'],
  pageSize: 'A4',
  orientation: 'portrait',
  status: 'DRAFT',
};

// Create or edit a template's identity — who it is for and what it covers. The
// design itself (fields, positions) is edited on the canvas, deliberately not
// here: one screen for "who may use it", another for "what it looks like".
export default function DocumentTemplateForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { toast } = useToast();
  const navigate = useNavigate();
  // Stays in whichever panel opened this screen (Admin or Super Admin).
  const base = usePanelBase();

  const [form, setForm] = useState(EMPTY);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const { data: categoryData } = useQuery({ queryKey: ['document-categories'], queryFn: documentCategoryApi.list });
  const { data: deptData } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list });
  // Picker: the whole catalogue is needed, then filtered client-side.
  const { data: courseData } = useQuery({ queryKey: ['courses'], queryFn: () => courseApi.list({ limit: 500 }) });
  const { data: existing } = useQuery({
    queryKey: ['admin-document-template', id],
    queryFn: () => adminDocumentApi.template(id),
    enabled: editing,
  });

  useEffect(() => {
    if (!existing?.data) return;
    const t = existing.data;
    setForm({
      name: t.name || '',
      category: t.category || '',
      description: t.description || '',
      departmentIds: (t.departmentIds || []).map((d) => d._id || d),
      courseId: t.courseId?._id || t.courseId || '',
      availableFor: t.availableFor?.length ? t.availableFor : ['student'],
      pageSize: t.pageSize || 'A4',
      orientation: t.orientation || 'portrait',
      status: t.status || 'DRAFT',
    });
  }, [existing]);

  const categories = categoryData?.data || [];
  const departments = deptData?.data || [];
  const courseOptions = (courseData?.data || []).map((c) => ({
    value: c._id,
    label: `${c.courseId || ''} — ${c.name}`.trim(),
  }));

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const toggleDepartment = (deptId) => {
    set({
      departmentIds: form.departmentIds.includes(deptId)
        ? form.departmentIds.filter((d) => d !== deptId)
        : [...form.departmentIds, deptId],
    });
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing) {
        await adminDocumentApi.update(id, {
          name: form.name,
          category: form.category,
          description: form.description,
          departmentIds: form.departmentIds,
          courseId: form.courseId || null,
          availableFor: form.availableFor,
          pageSize: form.pageSize,
          orientation: form.orientation,
          status: form.status,
        });
        toast('Template updated', 'success');
        navigate(`${base}/document-templates/${id}`);
      } else {
        const fd = new FormData();
        fd.append('name', form.name);
        fd.append('category', form.category);
        fd.append('description', form.description);
        fd.append('departmentIds', JSON.stringify(form.departmentIds));
        fd.append('availableFor', JSON.stringify(form.availableFor));
        fd.append('pageSize', form.pageSize);
        fd.append('orientation', form.orientation);
        fd.append('status', form.status);
        // A brand-new template starts with no fields — they are placed on the canvas.
        fd.append('fields', JSON.stringify([]));
        if (form.courseId) fd.append('courseId', form.courseId);
        if (file) fd.append('source', file);

        const res = await adminDocumentApi.create(fd);
        toast('Template created', 'success');
        navigate(`${base}/document-templates/${res.data._id}`);
      }
    } catch (err) {
      toast(err.response?.data?.message || 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-3xl">
      <button
        onClick={() => navigate(`${base}/document-templates`)}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-700 mb-4"
      >
        <ArrowLeft size={15} /> All templates
      </button>

      <h1 className="text-2xl font-bold text-slate-800 mb-5">{editing ? 'Edit template' : 'Add template'}</h1>

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Template name</label>
          <input
            required
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="EEE & Physics Experiment Cover"
            className="w-full h-11 rounded-lg border border-slate-300 px-3 text-sm"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Category</label>
            <select
              required
              value={form.category}
              onChange={(e) => set({ category: e.target.value })}
              className="w-full h-11 rounded-lg border border-slate-300 px-2 text-sm bg-white"
            >
              <option value="">Select a category…</option>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Status</label>
            <select
              value={form.status}
              onChange={(e) => set({ status: e.target.value })}
              className="w-full h-11 rounded-lg border border-slate-300 px-2 text-sm bg-white"
            >
              <option value="DRAFT">Draft (not offered to students)</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Description</label>
          <textarea
            rows={2}
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Laboratory experiment cover page"
            className="w-full rounded-lg border border-slate-300 p-3 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Department</label>
          <p className="text-xs text-slate-400 mb-2">Leave every box unchecked for “All Departments”.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {departments.map((d) => (
              <label key={d._id} className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={form.departmentIds.includes(d._id)}
                  onChange={() => toggleDepartment(d._id)}
                />
                {d.code || d.name}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Course</label>
          <p className="text-xs text-slate-400 mb-2">Leave empty for every course in scope.</p>
          <SearchableSelect
            value={form.courseId}
            onChange={(value) => set({ courseId: value })}
            options={[{ value: '', label: 'All courses' }, ...courseOptions]}
            placeholder="All courses"
            searchPlaceholder="Search courses…"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-600 mb-1">Available for</label>
          <div className="flex gap-4">
            {['student', 'faculty'].map((audience) => (
              <label key={audience} className="flex items-center gap-2 text-sm text-slate-600 capitalize">
                <input
                  type="checkbox"
                  checked={form.availableFor.includes(audience)}
                  onChange={() =>
                    set({
                      availableFor: form.availableFor.includes(audience)
                        ? form.availableFor.filter((a) => a !== audience)
                        : [...form.availableFor, audience],
                    })
                  }
                />
                {audience}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Page size</label>
            <select
              value={form.pageSize}
              onChange={(e) => set({ pageSize: e.target.value })}
              className="w-full h-11 rounded-lg border border-slate-300 px-2 text-sm bg-white"
            >
              <option value="A4">A4</option>
              <option value="LETTER">Letter</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Orientation</label>
            <select
              value={form.orientation}
              onChange={(e) => set({ orientation: e.target.value })}
              className="w-full h-11 rounded-lg border border-slate-300 px-2 text-sm bg-white"
            >
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </div>
        </div>

        {!editing && (
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Reference design (optional)</label>
            <p className="text-xs text-slate-400 mb-2">
              A PDF, PNG or JPG of the cover to position fields against. It is a visual aid — the fields you place are
              what get rendered.
            </p>
            <label className="flex items-center gap-2 h-11 px-4 rounded-lg border border-dashed border-slate-300 text-sm text-slate-500 cursor-pointer hover:bg-slate-50">
              <Upload size={15} />
              {file ? file.name : 'Choose a file…'}
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => navigate(`${base}/document-templates`)}
            className="h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-600"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="h-10 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-60"
          >
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create template'}
          </button>
        </div>
      </form>
    </div>
  );
}
