import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, FileText, Lock, Loader2, PencilLine, Send } from 'lucide-react';
import { documentCategoryApi, documentTemplateApi, documentApi, courseApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';

// Documents → Select Category → Select Template → Select Course → Enter editable
// fields → Preview → Generate. The official values are shown in their own
// "locked" section, resolved server-side (never edited or submitted here), so
// the split between what the portal knows and what the student types is the
// first thing the screen makes obvious.
export default function DocumentGenerate() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [category, setCategory] = useState('');
  const [templateId, setTemplateId] = useState(searchParams.get('template') || '');
  const [courseId, setCourseId] = useState('');
  const [inputData, setInputData] = useState({});
  const [previewHtml, setPreviewHtml] = useState('');
  const [busy, setBusy] = useState('');

  const { data: categoryData } = useQuery({ queryKey: ['document-categories'], queryFn: documentCategoryApi.list });
  const categories = categoryData?.data || [];

  const { data: templateData } = useQuery({
    queryKey: ['document-templates', category],
    queryFn: () => documentTemplateApi.list(category ? { category } : {}),
  });
  // A specific template chosen via ?template= stays selectable even after the
  // category filter narrows the list, so a "generate again" link is never a dead end.
  const templates = templateData?.data || [];

  const { data: courseData } = useQuery({ queryKey: ['document-courses'], queryFn: courseApi.mine });
  const courseOptions = (courseData?.data || []).map((c) => ({
    value: c._id,
    label: `${c.courseId || c.code || ''} — ${c.name}`.trim(),
  }));

  const { data: detailData } = useQuery({
    queryKey: ['document-template', templateId],
    queryFn: () => documentTemplateApi.get(templateId),
    enabled: Boolean(templateId),
  });
  const design = detailData?.data?.design;
  const fields = design?.fields || [];

  const { data: autofillData } = useQuery({
    queryKey: ['document-autofill', templateId, courseId],
    queryFn: () => documentTemplateApi.autofill(templateId, courseId),
    enabled: Boolean(templateId),
  });
  const lockedValues = autofillData?.data?.values || {};

  const lockedFields = fields.filter((f) => !f.editable);
  const editableFields = fields.filter((f) => f.editable);

  const buildPayload = () => ({ templateId, courseId: courseId || null, inputData });

  const preview = async () => {
    setBusy('preview');
    try {
      const res = await documentApi.preview(buildPayload());
      setPreviewHtml(res.data?.html || '');
    } catch (err) {
      toast(err.response?.data?.message || 'Could not build the preview', 'error');
    } finally {
      setBusy('');
    }
  };

  const generate = async () => {
    setBusy('generate');
    try {
      const res = await documentApi.generate(buildPayload());
      toast('Your PDF has been added to the generation queue.', 'success');
      navigate(`/documents/${res.data.jobId}`);
    } catch (err) {
      toast(err.response?.data?.message || 'Could not start generation', 'error');
      setBusy('');
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <button onClick={() => navigate('/documents')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-700 mb-4">
        <ArrowLeft size={15} /> All documents
      </button>

      <h1 className="text-2xl font-bold text-slate-800">New document</h1>
      <p className="text-sm text-slate-500 mt-1 mb-6">Pick a template, fill in what only you know, and generate the PDF.</p>

      {/* 1. Category */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">1. Category</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { setCategory(''); setTemplateId(''); }}
            className={`px-3 py-2 rounded-lg text-sm font-medium border ${!category ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => { setCategory(c.key); setTemplateId(''); }}
              className={`px-3 py-2 rounded-lg text-sm font-medium border ${category === c.key ? 'bg-brand-600 text-white border-brand-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </section>

      {/* 2. Template */}
      <section className="mb-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">2. Template</h2>
        {templates.length === 0 ? (
          <p className="text-sm text-slate-400">No templates are available to you in this category.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map((t) => (
              <button
                key={t._id}
                type="button"
                onClick={() => { setTemplateId(t._id); setPreviewHtml(''); }}
                className={`text-left bg-white rounded-xl border p-4 transition-colors ${templateId === t._id ? 'border-brand-500 ring-2 ring-brand-100' : 'border-slate-200 hover:border-brand-300'}`}
              >
                <span className="w-9 h-9 rounded-lg bg-slate-50 grid place-items-center mb-3">
                  <FileText size={16} className="text-slate-400" />
                </span>
                <p className="font-semibold text-slate-700 text-sm">{t.name}</p>
                {t.description && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{t.description}</p>}
                <p className="text-xs text-slate-400 mt-2">v{t.version} · {t.pageSize} {t.orientation}</p>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 3. Course */}
      {templateId && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">3. Course</h2>
          <div className="max-w-md">
            <SearchableSelect
              value={courseId}
              onChange={(value) => { setCourseId(value); setPreviewHtml(''); }}
              options={courseOptions}
              placeholder="Select a course"
              searchPlaceholder="Search your courses…"
            />
          </div>
        </section>
      )}

      {/* 4. Fields — locked vs editable, deliberately side by side */}
      {templateId && (
        <section className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Lock size={15} className="text-slate-500" />
              <h2 className="text-sm font-semibold text-slate-700">Official information (auto-filled)</h2>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Taken from your student record{courseId ? ' and the selected course' : ''}. Locked — the portal supplies these.
            </p>
            <dl className="space-y-1.5">
              {lockedFields.length === 0 && <p className="text-xs text-slate-400">Nothing is locked for this template.</p>}
              {lockedFields.map((f) => (
                <div key={f.key} className="flex items-baseline justify-between gap-3">
                  <dt className="text-xs text-slate-500">{f.label}</dt>
                  <dd className="text-sm text-slate-700 font-medium text-right">{lockedValues[f.key] || '—'}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <PencilLine size={15} className="text-brand-600" />
              <h2 className="text-sm font-semibold text-slate-700">Your information (editable)</h2>
            </div>
            <div className="space-y-3">
              {editableFields.length === 0 && <p className="text-xs text-slate-400">This template needs nothing typed.</p>}
              {editableFields.map((f) => (
                <div key={f.key}>
                  <label className="block text-xs text-slate-500 mb-1">
                    {f.label}{f.required && <span className="text-red-500"> *</span>}
                  </label>
                  <input
                    type={f.type === 'DATE' ? 'date' : f.type === 'NUMBER' ? 'number' : 'text'}
                    value={inputData[f.key] ?? f.defaultValue ?? ''}
                    onChange={(e) => { setInputData((prev) => ({ ...prev, [f.key]: e.target.value })); setPreviewHtml(''); }}
                    className="w-full h-11 sm:h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-800"
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              <button
                type="button"
                onClick={preview}
                disabled={busy === 'preview' || !templateId}
                className="h-10 px-4 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                {busy === 'preview' ? 'Building…' : 'Preview'}
              </button>
              <button
                type="button"
                onClick={generate}
                disabled={busy === 'generate' || !templateId}
                className="h-10 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-60 flex items-center gap-2"
              >
                {busy === 'generate' ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                Generate PDF
              </button>
            </div>
          </div>
        </section>
      )}

      {/* 5. Preview — the server-rendered HTML, never a PDF */}
      {previewHtml && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Preview</h2>
          <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-100">
            <iframe
              title="Document preview"
              srcDoc={previewHtml}
              sandbox=""
              className="w-full bg-white"
              style={{ height: '70vh' }}
            />
          </div>
          <p className="text-xs text-slate-400 mt-2">This is the same rendering the PDF is produced from.</p>
        </section>
      )}
    </div>
  );
}
