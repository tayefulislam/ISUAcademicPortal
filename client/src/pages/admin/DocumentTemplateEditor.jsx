import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, Plus, Save, Send, Upload } from 'lucide-react';
import { adminDocumentApi, documentApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import TemplateCanvas from '../../components/documents/TemplateCanvas.jsx';
import FieldMappingPanel from '../../components/documents/FieldMappingPanel.jsx';

function newField(index) {
  return {
    key: `field_${Date.now().toString(36)}_${index}`,
    label: `Field ${index + 1}`,
    type: 'USER_INPUT',
    source: '',
    required: false,
    defaultValue: '',
    staticValue: '',
    validation: {},
    formatting: {},
    x: 20,
    y: 30 + index * 8,
    width: 120,
    height: 8,
    fontSize: 12,
    fontFamily: '',
    bold: false,
    italic: false,
    align: 'left',
    color: '#111111',
  };
}

// Placeholder values so a preview renders even before the student's real answers
// exist — the editor is previewing the LAYOUT, not a real document.
function sampleInput(fields) {
  const data = {};
  for (const field of fields) {
    if (field.type === 'DATE') data[field.key] = '2026-09-20';
    else if (field.type === 'NUMBER') data[field.key] = '1';
    else data[field.key] = field.defaultValue || 'Sample';
  }
  return data;
}

export default function DocumentTemplateEditor() {
  const { id } = useParams();
  const { toast } = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [versionNumber, setVersionNumber] = useState(null);
  const [fields, setFields] = useState([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [busy, setBusy] = useState('');
  const [sourceFile, setSourceFile] = useState(null);

  const { data: templateData } = useQuery({
    queryKey: ['admin-document-template', id],
    queryFn: () => adminDocumentApi.template(id),
  });
  const template = templateData?.data;

  const { data: metaData } = useQuery({ queryKey: ['admin-document-meta'], queryFn: adminDocumentApi.meta });
  const meta = metaData?.data;

  const activeVersion = versionNumber ?? template?.currentVersion ?? null;

  const { data: versionData } = useQuery({
    queryKey: ['admin-document-version', id, activeVersion],
    queryFn: () => adminDocumentApi.version(id, activeVersion),
    enabled: Boolean(id && activeVersion),
  });
  const version = versionData?.data;

  // Load the design into local state whenever a different version is opened.
  useEffect(() => {
    if (version) {
      setFields(version.fields || []);
      setSelectedKey('');
      setPreviewHtml('');
    }
  }, [version]);

  // The reference design is a private object, so it is fetched through the
  // authenticated API as a blob and used as a temporary background image.
  const { data: backgroundUrl } = useQuery({
    queryKey: ['admin-document-source', id, activeVersion, version?.sourceFile?.s3Key],
    queryFn: () => adminDocumentApi.sourceUrl(id, activeVersion),
    enabled: Boolean(version?.sourceFile?.s3Key),
    retry: false,
    staleTime: Infinity,
  });

  const selectedField = useMemo(() => fields.find((f) => f.key === selectedKey), [fields, selectedKey]);

  const updateField = (next) => setFields((prev) => prev.map((f) => (f.key === next.key ? next : f)));
  const addField = () => {
    const field = newField(fields.length);
    setFields((prev) => [...prev, field]);
    setSelectedKey(field.key);
  };
  const removeField = () => {
    setFields((prev) => prev.filter((f) => f.key !== selectedKey));
    setSelectedKey('');
  };

  const preview = async () => {
    setBusy('preview');
    try {
      const res = await documentApi.preview({ templateId: id, inputData: sampleInput(fields) });
      setPreviewHtml(res.data?.html || '');
    } catch (err) {
      toast(err.response?.data?.message || 'Could not build the preview', 'error');
    } finally {
      setBusy('');
    }
  };

  // Saving always appends a version — the one already published is never edited,
  // because documents already generated pin it.
  const saveVersion = async () => {
    setBusy('save');
    try {
      const fd = new FormData();
      fd.append('fields', JSON.stringify(fields));
      if (sourceFile) fd.append('source', sourceFile);
      const res = await adminDocumentApi.createVersion(id, fd);
      toast(`Saved as v${res.data.version}`, 'success');
      setSourceFile(null);
      setVersionNumber(res.data.version);
      qc.invalidateQueries({ queryKey: ['admin-document-template', id] });
      qc.invalidateQueries({ queryKey: ['admin-document-templates'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Could not save the version', 'error');
    } finally {
      setBusy('');
    }
  };

  const publish = async () => {
    setBusy('publish');
    try {
      await adminDocumentApi.setStatus(id, 'ACTIVE');
      toast('Template published', 'success');
      qc.invalidateQueries({ queryKey: ['admin-document-template', id] });
      qc.invalidateQueries({ queryKey: ['admin-document-templates'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Could not publish', 'error');
    } finally {
      setBusy('');
    }
  };

  if (!template) return <p className="text-slate-400">Loading…</p>;

  return (
    <div>
      <button
        onClick={() => navigate('/admin/document-templates')}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-700 mb-4"
      >
        <ArrowLeft size={15} /> All templates
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{template.name}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {template.category.replace(/_/g, ' ')} ·{' '}
            {template.departmentIds?.length ? template.departmentIds.map((d) => d.code || d.name).join(', ') : 'All departments'} ·{' '}
            {template.status}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeVersion || ''}
            onChange={(e) => setVersionNumber(Number(e.target.value))}
            className="h-10 rounded-lg border border-slate-300 px-2 text-sm bg-white"
          >
            {(template.versions || []).map((v) => (
              <option key={v._id} value={v.version}>
                v{v.version}{v.version === template.currentVersion ? ' (current)' : ''}
              </option>
            ))}
          </select>
          <button
            onClick={preview}
            disabled={busy === 'preview'}
            className="h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
          >
            <Eye size={15} /> Preview
          </button>
          <button
            onClick={saveVersion}
            disabled={busy === 'save'}
            className="h-10 px-3 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 flex items-center gap-2"
          >
            <Save size={15} /> Save as new version
          </button>
          <button
            onClick={publish}
            disabled={busy === 'publish' || template.status === 'ACTIVE'}
            className="h-10 px-3 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-60 flex items-center gap-2"
          >
            <Send size={15} /> Publish
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-slate-500">
              Drag a field to move it. Coordinates are millimetres — the same units the PDF uses.
            </p>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 cursor-pointer hover:bg-slate-50">
                <Upload size={13} />
                {sourceFile ? sourceFile.name : 'Replace reference'}
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => setSourceFile(e.target.files?.[0] || null)}
                />
              </label>
              <button
                onClick={addField}
                className="h-9 px-3 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 flex items-center gap-1.5"
              >
                <Plus size={13} /> Add field
              </button>
            </div>
          </div>

          <div className="bg-slate-100 border border-slate-200 rounded-xl p-4 overflow-auto">
            <TemplateCanvas
              pageSize={version?.pageSize || template.pageSize}
              orientation={version?.orientation || template.orientation}
              fields={fields}
              backgroundUrl={backgroundUrl || ''}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              onChange={setFields}
            />
          </div>

          {previewHtml && (
            <div className="mt-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-2">Preview (sample data)</h2>
              <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-100">
                <iframe title="Template preview" srcDoc={previewHtml} sandbox="" className="w-full bg-white" style={{ height: '60vh' }} />
              </div>
            </div>
          )}
        </div>

        <aside className="bg-white border border-slate-200 rounded-xl p-4 h-fit lg:sticky lg:top-20">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Field</h2>
          <FieldMappingPanel
            field={selectedField}
            meta={meta}
            onChange={updateField}
            onDelete={removeField}
          />
        </aside>
      </div>
    </div>
  );
}
