import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Copy, FileText, Plus, Power, Trash2, Wand2 } from 'lucide-react';
import { adminDocumentApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import usePanelBase from '../../hooks/usePanelBase.js';

const STATUS_STYLES = {
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  DRAFT: 'bg-slate-100 text-slate-600',
  INACTIVE: 'bg-amber-50 text-amber-700',
};

const departmentLabel = (t) =>
  t.departmentIds?.length ? t.departmentIds.map((d) => d.code || d.name).join(', ') : 'All';
const courseLabel = (t) => (t.courseId ? [t.courseId.courseId, t.courseId.name].filter(Boolean).join(' ') : 'All');

export default function DocumentTemplates() {
  const { toast } = useToast();
  const qc = useQueryClient();
  // Keeps every link in whichever panel opened this screen (Admin or Super Admin).
  const base = usePanelBase();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-document-templates'],
    queryFn: () => adminDocumentApi.templates({}),
  });
  const templates = data?.data || [];
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-document-templates'] });

  const toggleStatus = async (template) => {
    const next = template.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await adminDocumentApi.setStatus(template._id, next);
      toast(next === 'ACTIVE' ? 'Template activated' : 'Template deactivated', 'success');
      refresh();
    } catch (err) {
      toast(err.response?.data?.message || 'Could not change the status', 'error');
    }
  };

  const duplicate = async (template) => {
    try {
      await adminDocumentApi.duplicate(template._id, `${template.name} (copy)`);
      toast('Template duplicated as a draft', 'success');
      refresh();
    } catch (err) {
      toast(err.response?.data?.message || 'Could not duplicate', 'error');
    }
  };

  const remove = async (template) => {
    if (!confirm(`Delete "${template.name}"? Documents already generated keep their own copy of the design.`)) return;
    try {
      await adminDocumentApi.remove(template._id);
      toast('Template deleted', 'success');
      refresh();
    } catch (err) {
      toast(err.response?.data?.message || 'Could not delete', 'error');
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Document Templates</h1>
          <p className="text-sm text-slate-500 mt-1">
            Cover pages and other generated documents. Editing a published design creates a new version, so documents
            already generated keep the design they were made with.
          </p>
        </div>
        <Link
          to={`${base}/document-templates/new`}
          className="shrink-0 flex items-center gap-2 h-10 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
        >
          <Plus size={16} /> Add template
        </Link>
      </div>

      {isLoading ? (
        <p className="text-slate-400">Loading…</p>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <FileText className="mx-auto mb-3" size={40} />
          <p className="font-semibold text-slate-600">No templates yet</p>
          <p className="text-sm mt-1">Upload a cover design to get started.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Template</th>
                  <th className="text-left font-medium px-4 py-3">Category</th>
                  <th className="text-left font-medium px-4 py-3">Department</th>
                  <th className="text-left font-medium px-4 py-3">Course</th>
                  <th className="text-left font-medium px-4 py-3">Version</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="text-right font-medium px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {templates.map((t) => (
                  <tr key={t._id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-700">{t.name}</p>
                      {t.description && <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{t.description}</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-600 capitalize">{t.category.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-slate-600">{departmentLabel(t)}</td>
                    <td className="px-4 py-3 text-slate-600">{courseLabel(t)}</td>
                    <td className="px-4 py-3 text-slate-600">v{t.currentVersion}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[t.status] || STATUS_STYLES.DRAFT}`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          to={`${base}/document-templates/${t._id}`}
                          className="p-2 rounded-md text-slate-500 hover:bg-slate-100"
                          title="Preview / edit design"
                        >
                          <Wand2 size={16} />
                        </Link>
                        <Link
                          to={`${base}/document-templates/${t._id}/edit`}
                          className="p-2 rounded-md text-slate-500 hover:bg-slate-100"
                          title="Edit details"
                        >
                          <FileText size={16} />
                        </Link>
                        <button
                          onClick={() => duplicate(t)}
                          className="p-2 rounded-md text-slate-500 hover:bg-slate-100"
                          title="Duplicate"
                        >
                          <Copy size={16} />
                        </button>
                        <button
                          onClick={() => toggleStatus(t)}
                          className={`p-2 rounded-md hover:bg-slate-100 ${t.status === 'ACTIVE' ? 'text-amber-600' : 'text-emerald-600'}`}
                          title={t.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                        >
                          <Power size={16} />
                        </button>
                        <button
                          onClick={() => remove(t)}
                          className="p-2 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title="Delete"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
