import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlignLeft,
  ArrowLeft,
  Eye,
  Image as ImageIcon,
  Minus,
  Save,
  Send,
  Trash2,
  Type,
  Upload,
  Variable,
  Zap,
} from 'lucide-react';
import { adminDocumentApi, documentApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import TemplateCanvas, { pageSizeMm } from '../../components/documents/TemplateCanvas.jsx';
import FieldMappingPanel from '../../components/documents/FieldMappingPanel.jsx';

// The palette an admin drags from. Each entry is a *kind of element*, not a
// fixed field — where it lands on the page becomes its coordinates.
const PALETTE = [
  { type: 'STATIC', label: 'Text', hint: 'Fixed text', icon: Type },
  { type: 'AUTO', label: 'Dynamic field', hint: 'From the student record', icon: Variable },
  { type: 'IMAGE', label: 'Image / Logo', hint: 'From the server’s img folder', icon: ImageIcon },
  { type: 'LINE', label: 'Rule / line', hint: 'A divider', icon: Minus },
];

function nextZ(fields) {
  return fields.length ? Math.max(...fields.map((f) => Number(f.zIndex) || 0)) + 1 : 0;
}

/**
 * The visual template editor.
 *
 * <p>Everything about a design lives in the database and is assembled here:
 * elements are dragged in from the palette, positioned in millimetres on an A4
 * canvas, aligned, stacked (z-order), and given their source and styling. Saving
 * always appends a NEW version — the version a document was generated from is
 * never rewritten.
 */
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

  // The image library (the university logo lives here). Fetched as blobs,
  // because the images are served by the authenticated API.
  const { data: assetData } = useQuery({ queryKey: ['admin-document-assets'], queryFn: adminDocumentApi.assets });
  const assetList = assetData?.data || [];
  const { data: assetUrls } = useQuery({
    queryKey: ['admin-document-asset-urls', assetList.map((a) => a.name).join(',')],
    queryFn: async () => {
      const map = {};
      for (const asset of assetList) {
        try {
          map[asset.name] = await adminDocumentApi.assetUrl(asset.name);
        } catch {
          // A missing/unreadable image simply has no preview.
        }
      }
      return map;
    },
    enabled: assetList.length > 0,
    staleTime: Infinity,
  });
  const assets = useMemo(
    () => assetList.map((a) => ({ ...a, url: assetUrls?.[a.name] || '' })),
    [assetList, assetUrls]
  );

  const activeVersion = versionNumber ?? template?.currentVersion ?? null;

  const { data: versionData } = useQuery({
    queryKey: ['admin-document-version', id, activeVersion],
    queryFn: () => adminDocumentApi.version(id, activeVersion),
    enabled: Boolean(id && activeVersion),
  });
  const version = versionData?.data;

  useEffect(() => {
    if (version) {
      setFields(version.fields || []);
      setSelectedKey('');
      setPreviewHtml('');
    }
  }, [version]);

  const pageSize = version?.pageSize || template?.pageSize || 'A4';
  const orientation = version?.orientation || template?.orientation || 'portrait';
  const page = pageSizeMm(pageSize, orientation);

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
  const removeField = (key) => {
    setFields((prev) => prev.filter((f) => f.key !== (key || selectedKey)));
    setSelectedKey('');
  };

  /** Adds an element at the point it was dropped, with sensible starting values. */
  const addFromPalette = ({ type, asset, x = 20, y = 20 }) => {
    const base = {
      key: `el_${Date.now().toString(36)}_${fields.length}`,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      zIndex: nextZ(fields),
      align: 'left',
      color: '#111111',
      validation: {},
      formatting: {},
    };

    let field;
    if (type === 'IMAGE') {
      const chosen = asset || assetList[0]?.name || '';
      field = {
        ...base,
        type: 'IMAGE',
        label: chosen ? chosen.replace(/\.[^.]+$/, '') : 'Image',
        asset: chosen,
        width: 34,
        height: 34,
      };
    } else if (type === 'LINE') {
      field = { ...base, type: 'LINE', label: 'Rule', width: 170, height: 0.5 };
    } else if (type === 'AUTO') {
      field = { ...base, type: 'AUTO', label: 'Dynamic field', source: 'student.name', width: 120, height: 8, fontSize: 12 };
    } else {
      field = { ...base, type: 'STATIC', label: 'Text', staticValue: 'Text', width: 120, height: 8, fontSize: 12 };
    }

    setFields((prev) => [...prev, field]);
    setSelectedKey(field.key);
  };

  const bringToFront = () => setFields((prev) => {
    const max = Math.max(0, ...prev.map((f) => Number(f.zIndex) || 0));
    return prev.map((f) => (f.key === selectedKey ? { ...f, zIndex: max + 1 } : f));
  });

  const sendToBack = () => setFields((prev) => {
    const min = Math.min(0, ...prev.map((f) => Number(f.zIndex) || 0));
    return prev.map((f) => (f.key === selectedKey ? { ...f, zIndex: min - 1 } : f));
  });

  const handleAlign = (mode) => setFields((prev) => prev.map((f) => {
    if (f.key !== selectedKey) return f;
    const width = Number(f.width) || 0;
    const height = Number(f.height) || 0;
    const round = (n) => Math.round(n * 10) / 10;
    if (mode === 'left') return { ...f, x: 0 };
    if (mode === 'right') return { ...f, x: Math.max(0, round(page.w - width)) };
    if (mode === 'center') return { ...f, x: Math.max(0, round((page.w - width) / 2)) };
    if (mode === 'middle') return { ...f, y: Math.max(0, round((page.h - height) / 2)) };
    return f;
  }));

  // Placeholder values so a preview renders before the student's real answers
  // exist — the editor previews the LAYOUT, not a real document.
  const sampleInput = (list) => {
    const data = {};
    for (const field of list) {
      if (field.type === 'LINE' || field.type === 'IMAGE' || field.type === 'STATIC') continue;
      if (field.type === 'DATE') data[field.key] = '2026-09-20';
      else if (field.type === 'NUMBER') data[field.key] = '1';
      else data[field.key] = field.defaultValue || 'Sample';
    }
    return data;
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

  const orderedFields = [...fields].sort((a, b) => (Number(b.zIndex) || 0) - (Number(a.zIndex) || 0));

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

      <div className="grid grid-cols-1 lg:grid-cols-[190px_minmax(0,1fr)_320px] gap-5">
        {/* Palette — drag an element onto the page. */}
        <aside className="bg-white border border-slate-200 rounded-xl p-3 h-fit lg:sticky lg:top-20">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">Elements</h2>
          <p className="text-[11px] text-slate-400 mb-3">Drag onto the page, or click to add.</p>
          <div className="space-y-1.5">
            {PALETTE.map((item) => (
              <div
                key={item.type}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'copy';
                  e.dataTransfer.setData('text/plain', JSON.stringify({ type: item.type }));
                }}
                onClick={() => addFromPalette({ type: item.type })}
                className="flex items-center gap-2 px-2.5 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 cursor-grab active:cursor-grabbing hover:bg-brand-50 hover:border-brand-300"
                title={item.hint}
              >
                <item.icon size={15} className="text-slate-400 shrink-0" />
                <span className="truncate">{item.label}</span>
              </div>
            ))}
          </div>

          {/* Each image in the library is its own drag source, so a specific logo
              can be dropped straight onto the page. */}
          {assets.length > 0 && (
            <>
              <h3 className="text-[11px] font-semibold text-slate-500 mt-4 mb-2">Images</h3>
              <div className="grid grid-cols-2 gap-2">
                {assets.map((asset) => (
                  <div
                    key={asset.name}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'copy';
                      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'IMAGE', asset: asset.name }));
                    }}
                    onClick={() => addFromPalette({ type: 'IMAGE', asset: asset.name })}
                    className="p-1.5 rounded-lg border border-slate-200 cursor-grab active:cursor-grabbing hover:bg-brand-50 hover:border-brand-300"
                    title={asset.name}
                  >
                    {asset.url
                      ? <img src={asset.url} alt={asset.name} className="h-10 w-full object-contain" />
                      : <span className="block h-10 text-[10px] text-slate-400 text-center leading-10">no preview</span>}
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>

        <div>
          <div className="flex items-center justify-between mb-3 gap-3">
            <p className="text-xs text-slate-500">
              Drag to move (it snaps to the page centre), or drag an element in from the left. Millimetres — the units the PDF uses.
            </p>
            <label className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 cursor-pointer hover:bg-slate-50 shrink-0">
              <Upload size={13} />
              {sourceFile ? sourceFile.name : 'Reference'}
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="hidden"
                onChange={(e) => setSourceFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          <div className="bg-slate-100 border border-slate-200 rounded-xl p-4 overflow-auto">
            <TemplateCanvas
              pageSize={pageSize}
              orientation={orientation}
              fields={fields}
              assets={assetUrls || {}}
              backgroundUrl={backgroundUrl || ''}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              onChange={setFields}
              onDropNew={addFromPalette}
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

        <div className="space-y-4">
          <aside className="bg-white border border-slate-200 rounded-xl p-3">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">
              On the page <span className="text-slate-400 font-normal">({fields.length})</span>
            </h2>
            <div className="max-h-56 overflow-y-auto space-y-1">
              {orderedFields.length === 0 && (
                <p className="text-xs text-slate-400">Nothing yet — drag an element in.</p>
              )}
              {orderedFields.map((f) => (
                <div
                  key={f.key}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer ${
                    f.key === selectedKey ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50 text-slate-600'
                  }`}
                  onClick={() => setSelectedKey(f.key)}
                >
                  <Zap size={12} className="text-slate-400 shrink-0" />
                  <span className="truncate flex-1">{f.label || f.key}</span>
                  <span className="text-[10px] text-slate-400">{f.type}</span>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeField(f.key); }}
                    className="p-1 rounded text-slate-300 hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => addFromPalette({ type: 'STATIC' })}
              className="mt-2 w-full h-8 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 flex items-center justify-center gap-1.5"
            >
              <AlignLeft size={12} /> Add text
            </button>
          </aside>

          <aside className="bg-white border border-slate-200 rounded-xl p-4 lg:sticky lg:top-20">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Element</h2>
            <FieldMappingPanel
              field={selectedField}
              meta={meta}
              assets={assets}
              pageWidthMm={page.w}
              pageHeightMm={page.h}
              onChange={updateField}
              onDelete={() => removeField()}
              onBringToFront={bringToFront}
              onSendToBack={sendToBack}
              onAlign={handleAlign}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
