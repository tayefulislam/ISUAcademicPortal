import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlignLeft,
  ArrowLeft,
  Eye,
  Image as ImageIcon,
  Minus,
  Redo2,
  Save,
  Send,
  Square,
  Trash2,
  Type,
  Undo2,
  Upload,
  Variable,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { adminDocumentApi, documentApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import useHistory from '../../hooks/useHistory.js';
import usePanelBase from '../../hooks/usePanelBase.js';
import TemplateCanvas, { pageSizeMm, DEFAULT_PX_PER_MM } from '../../components/documents/TemplateCanvas.jsx';
import FieldMappingPanel from '../../components/documents/FieldMappingPanel.jsx';
import FontSelect from '../../components/documents/FontSelect.jsx';

// The palette an admin drags from. Each entry is a *kind of element*, not a
// fixed field — where it lands on the page becomes its coordinates.
const PALETTE = [
  { type: 'STATIC', label: 'Text', hint: 'Fixed text', icon: Type },
  { type: 'AUTO', label: 'Dynamic field', hint: 'From the student record', icon: Variable },
  { type: 'IMAGE', label: 'Image / Logo', hint: 'From the server’s img folder', icon: ImageIcon },
  { type: 'LINE', label: 'Rule / line', hint: 'A divider', icon: Minus },
  { type: 'BOX', label: 'Box / border', hint: 'A rectangle or page frame', icon: Square },
];

function nextZ(fields) {
  return fields.length ? Math.max(...fields.map((f) => Number(f.zIndex) || 0)) + 1 : 0;
}

const round1 = (value) => Math.round(value * 10) / 10;

/**
 * Builds an element for the point it was dropped on.
 *
 * @param {{type:string, asset?:string, x?:number, y?:number, index:number, z:number}} spec
 */
function makeElement({ type, asset, x = 20, y = 20, index, z }) {
  const base = {
    key: `el_${Date.now().toString(36)}_${index}`,
    x: round1(x),
    y: round1(y),
    zIndex: z,
    align: 'left',
    color: '#111111',
    validation: {},
    formatting: {},
  };

  if (type === 'IMAGE') {
    const chosen = asset || '';
    return {
      ...base,
      type: 'IMAGE',
      label: chosen ? chosen.replace(/\.[^.]+$/, '') : 'Image',
      asset: chosen,
      width: 34,
      height: 34,
    };
  }
  if (type === 'LINE') {
    return { ...base, type: 'LINE', label: 'Rule', width: 170, height: 0.5 };
  }
  if (type === 'BOX') {
    // A drawn rectangle — the admin frames the page or draws a panel. It has no
    // value, so it prints its border/shading alone.
    return {
      ...base,
      type: 'BOX',
      label: 'Box',
      width: 120,
      height: 40,
      borderWidth: 0.4,
      borderStyle: 'solid',
      borderColor: '#111111',
    };
  }
  if (type === 'AUTO') {
    return { ...base, type: 'AUTO', label: 'Dynamic field', source: 'student.name', width: 120, height: 8, fontSize: 12 };
  }
  return { ...base, type: 'STATIC', label: 'Text', staticValue: 'Text', width: 120, height: 8, fontSize: 12 };
}

/**
 * The visual template editor.
 *
 * <p>Everything about a design lives in the database and is assembled here:
 * elements are dragged in from the palette, moved and RESIZED on an A4 canvas,
 * aligned, stacked (z-order) and given their source and styling. The whole
 * session is undoable — Ctrl+Z / Ctrl+Shift+Z (or the toolbar buttons) — and
 * saving always appends a NEW version, because the version a document was
 * generated from is never rewritten.
 */
export default function DocumentTemplateEditor() {
  const { id } = useParams();
  const { toast } = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  // Stays in whichever panel opened this screen (Admin or Super Admin).
  const base = usePanelBase();

  const [versionNumber, setVersionNumber] = useState(null);
  const history = useHistory([]);
  const fields = history.state;
  const [selectedKey, setSelectedKey] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [busy, setBusy] = useState('');
  const [sourceFile, setSourceFile] = useState(null);
  // Canvas zoom (1 = 100%) and the page-level typography the version carries.
  const [zoom, setZoom] = useState(1);
  const [pageStyle, setPageStyle] = useState({ fontFamily: '', baseFontSize: 12, textColor: '#111111' });
  // The editor's own clipboard, for Ctrl+C / Ctrl+V of one element.
  const clipboard = useRef(null);

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
    () => assetList.map((a) => ({ ...a, name: a.name, url: assetUrls?.[a.name] || '' })),
    [assetList, assetUrls]
  );

  const activeVersion = versionNumber ?? template?.currentVersion ?? null;

  const { data: versionData } = useQuery({
    queryKey: ['admin-document-version', id, activeVersion],
    queryFn: () => adminDocumentApi.version(id, activeVersion),
    enabled: Boolean(id && activeVersion),
  });
  const version = versionData?.data;

  // Load the design into the editor whenever a different version is opened, and
  // start that version's history fresh.
  useEffect(() => {
    if (version) {
      history.reset(version.fields || []);
      setPageStyle({
        fontFamily: version.styleConfig?.fontFamily || '',
        baseFontSize: version.styleConfig?.baseFontSize ?? 12,
        textColor: version.styleConfig?.textColor || '#111111',
      });
      setSelectedKey('');
      setPreviewHtml('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const pageSize = version?.pageSize || template?.pageSize || 'A4';
  const orientation = version?.orientation || template?.orientation || 'portrait';
  const page = pageSizeMm(pageSize, orientation);

  const { data: backgroundUrl } = useQuery({
    queryKey: ['admin-document-source', id, activeVersion, version?.sourceFile?.s3Key],
    queryFn: () => adminDocumentApi.sourceUrl(id, activeVersion),
    enabled: Boolean(version?.sourceFile?.s3Key),
    retry: false,
    staleTime: Infinity,
  });

  const selectedField = useMemo(() => fields.find((f) => f.key === selectedKey), [fields, selectedKey]);

  // A property edit: coalesced by field, so typing into one box is a single
  // undo step rather than one per keystroke.
  const updateField = (next) => history.commit(fields.map((f) => (f.key === next.key ? next : f)), next.key);

  const removeField = (key) => {
    history.commit(fields.filter((f) => f.key !== (key || selectedKey)));
    setSelectedKey('');
  };

  const addFromPalette = ({ type, asset, x = 20, y = 20 }) => {
    const element = makeElement({ type, asset, x, y, index: fields.length, z: nextZ(fields) });
    history.commit([...fields, element]);
    setSelectedKey(element.key);
  };

  /**
   * A border drawn exactly around the page — the frame a cover design usually
   * has. One click rather than making the admin size a box to the page by hand.
   */
  const addPageBorder = () => {
    const element = makeElement({ type: 'BOX', x: 0, y: 0, index: fields.length, z: nextZ(fields) });
    history.commit([
      ...fields,
      { ...element, label: 'Page border', x: 0, y: 0, width: page.w, height: page.h, borderWidth: 0.5 },
    ]);
    setSelectedKey(element.key);
  };

  /** A copy of the selected element, offset slightly so it is visibly a new one. */
  const duplicateSelected = () => {
    if (!selectedField) return;
    const copy = {
      ...selectedField,
      key: `el_${Date.now().toString(36)}_${fields.length}`,
      x: Math.min(page.w - 5, Number(selectedField.x || 0) + 5),
      y: Math.min(page.h - 5, Number(selectedField.y || 0) + 5),
      zIndex: nextZ(fields),
    };
    history.commit([...fields, copy]);
    setSelectedKey(copy.key);
  };

  const copySelected = () => {
    if (selectedField) clipboard.current = { ...selectedField };
  };

  const pasteElement = () => {
    const source = clipboard.current;
    if (!source) return;
    const pasted = {
      ...source,
      key: `el_${Date.now().toString(36)}_${fields.length}`,
      x: Math.min(page.w - 5, Number(source.x || 0) + 5),
      y: Math.min(page.h - 5, Number(source.y || 0) + 5),
      zIndex: nextZ(fields),
    };
    history.commit([...fields, pasted]);
    setSelectedKey(pasted.key);
  };

  const bringToFront = () => {
    const max = Math.max(0, ...fields.map((f) => Number(f.zIndex) || 0));
    history.commit(fields.map((f) => (f.key === selectedKey ? { ...f, zIndex: max + 1 } : f)));
  };

  const sendToBack = () => {
    const min = Math.min(0, ...fields.map((f) => Number(f.zIndex) || 0));
    history.commit(fields.map((f) => (f.key === selectedKey ? { ...f, zIndex: min - 1 } : f)));
  };

  const handleAlign = (mode) => history.commit(fields.map((f) => {
    if (f.key !== selectedKey) return f;
    const width = Number(f.width) || 0;
    const height = Number(f.height) || 0;
    if (mode === 'left') return { ...f, x: 0 };
    if (mode === 'right') return { ...f, x: Math.max(0, round1(page.w - width)) };
    if (mode === 'center') return { ...f, x: Math.max(0, round1((page.w - width) / 2)) };
    if (mode === 'middle') return { ...f, y: Math.max(0, round1((page.h - height) / 2)) };
    return f;
  }));

  const nudgeSelected = (dx, dy) => {
    if (!selectedKey) return;
    history.commit(
      fields.map((f) => (f.key === selectedKey
        ? { ...f, x: Math.max(0, round1((Number(f.x) || 0) + dx)), y: Math.max(0, round1((Number(f.y) || 0) + dy)) }
        : f)),
      `nudge:${selectedKey}`
    );
  };

  // Keyboard: undo/redo anywhere, arrow keys to nudge the selected element.
  // Deliberately inert while a text field has focus, so typing (and the
  // browser's own undo inside an input) is never hijacked.
  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const tag = (target?.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
      const mod = event.ctrlKey || event.metaKey;

      if (mod && event.key.toLowerCase() === 'z') {
        if (typing && !event.shiftKey) return; // let the input undo its own text
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        history.redo();
        return;
      }
      if (typing) return;

      // Clipboard and element shortcuts. Paste works with nothing selected (the
      // editor has its own clipboard); the rest need a selection.
      if (mod && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteElement();
        return;
      }
      if (!selectedKey) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        removeField();
        return;
      }
      if (mod && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelected();
        return;
      }

      const step = event.shiftKey ? 10 : 1;
      const moves = {
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      nudgeSelected(move[0], move[1]);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, fields, history]);

  // Placeholder values so a preview renders before the student's real answers
  // exist — the editor previews the LAYOUT, not a real document.
  const sampleInput = (list) => {
    const data = {};
    for (const field of list) {
      if (field.type === 'LINE' || field.type === 'IMAGE' || field.type === 'STATIC' || field.type === 'BOX') continue;
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
      const payload = new FormData();
      payload.append('fields', JSON.stringify(fields));
      // The page defaults ride with the version, so the document's typography is
      // part of the design rather than a per-element repetition.
      payload.append('styleConfig', JSON.stringify(pageStyle));
      if (sourceFile) payload.append('source', sourceFile);
      const res = await adminDocumentApi.createVersion(id, payload);
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
        onClick={() => navigate(`${base}/document-templates`)}
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
          {/* Undo / redo */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-white overflow-hidden">
            <button
              type="button"
              onClick={history.undo}
              disabled={!history.canUndo}
              title="Undo (Ctrl+Z)"
              className="h-10 px-2.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white"
            >
              <Undo2 size={16} />
            </button>
            <button
              type="button"
              onClick={history.redo}
              disabled={!history.canRedo}
              title="Redo (Ctrl+Shift+Z)"
              className="h-10 px-2.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:hover:bg-white border-l border-slate-200"
            >
              <Redo2 size={16} />
            </button>
          </div>

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

          {/* Zoom, like a document window. */}
          <div className="flex items-center rounded-lg border border-slate-200 bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))}
              className="h-10 px-2 text-slate-600 hover:bg-slate-50"
              title="Zoom out"
            >
              <ZoomOut size={16} />
            </button>
            <span className="h-10 px-1 grid place-items-center text-xs text-slate-500 w-12 border-x border-slate-200">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(2, Math.round((z + 0.25) * 100) / 100))}
              className="h-10 px-2 text-slate-600 hover:bg-slate-50"
              title="Zoom in"
            >
              <ZoomIn size={16} />
            </button>
          </div>
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

          <button
            type="button"
            onClick={addPageBorder}
            className="mt-2 w-full h-9 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-brand-50 hover:border-brand-300 flex items-center justify-center gap-1.5"
            title="Add a border around the whole A4 page"
          >
            <Square size={13} /> A4 page border
          </button>

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
              Drag to move · drag a <strong>grip</strong> to resize · <kbd className="px-1 border rounded">Ctrl</kbd> for
              0.1 mm steps · <kbd className="px-1 border rounded">Shift</kbd> to keep the shape · arrows nudge ·
              Ctrl+D duplicate · Ctrl+C/V copy · Del removes · Ctrl+Z undo
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
              pxPerMm={DEFAULT_PX_PER_MM * zoom}
              fields={fields}
              assets={assetUrls || {}}
              backgroundUrl={backgroundUrl || ''}
              defaultFont={pageStyle.fontFamily || ''}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
              onChange={history.update}
              onChangeStart={history.begin}
              onChangeEnd={history.end}
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
          {/* Page defaults: the typography the whole document inherits, part of
              the version rather than repeated on every element. */}
          <aside className="bg-white border border-slate-200 rounded-xl p-3">
            <h2 className="text-sm font-semibold text-slate-700 mb-2">Page</h2>
            <div className="space-y-2">
              <div>
                <label className="block text-[11px] text-slate-500 mb-1">Default font</label>
                <FontSelect
                  value={pageStyle.fontFamily || ''}
                  onChange={(fontFamily) => setPageStyle({ ...pageStyle, fontFamily })}
                  fonts={meta?.fonts}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 items-end">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">Base size (pt)</label>
                  <input
                    type="number"
                    value={pageStyle.baseFontSize ?? 12}
                    onChange={(e) => setPageStyle({ ...pageStyle, baseFontSize: e.target.value })}
                    className="w-full h-9 rounded-lg border border-slate-300 px-2 text-sm"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input
                    type="color"
                    value={/^#[0-9a-fA-F]{6}$/.test(pageStyle.textColor || '') ? pageStyle.textColor : '#111111'}
                    onChange={(e) => setPageStyle({ ...pageStyle, textColor: e.target.value })}
                    className="w-7 h-7 rounded border border-slate-300"
                  />
                  Text colour
                </label>
              </div>
            </div>
          </aside>

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
              onDuplicate={duplicateSelected}
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
