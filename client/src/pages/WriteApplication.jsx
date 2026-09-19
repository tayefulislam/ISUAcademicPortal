import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Copy, Download, FileText, FileType2, Redo2, RotateCcw, Save, Send, Sparkles, Undo2, Wand2,
} from 'lucide-react';
import { applicationApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import CreditBadge from '../components/CreditBadge.jsx';

const AI_ACTIONS = [
  { key: 'formal', label: 'Make More Formal' },
  { key: 'shorter', label: 'Make Shorter' },
  { key: 'detailed', label: 'Make More Detailed' },
  { key: 'grammar', label: 'Improve Grammar' },
  { key: 'rewrite', label: 'Rewrite' },
  { key: 'respectful', label: 'Add Respectful Tone' },
  { key: 'trim', label: 'Remove Unnecessary Text' },
];

/** A text field that remembers edits and offers undo/redo, coalesced by time. */
function useUndoableText(initial = '') {
  const [value, setValue] = useState(initial);
  const past = useRef([]);
  const future = useRef([]);
  const lastAt = useRef(0);
  const [, force] = useState(0);

  const change = useCallback((next) => {
    const now = Date.now();
    // A burst of typing is one undo step; a pause starts a new one.
    if (now - lastAt.current > 700) {
      if (value !== next) {
        past.current = [...past.current.slice(-99), value];
        future.current = [];
      }
    }
    lastAt.current = now;
    setValue(next);
    force((n) => n + 1);
  }, [value]);

  const replace = useCallback((next) => {
    if (next === value) return;
    past.current = [...past.current.slice(-99), value];
    future.current = [];
    lastAt.current = Date.now();
    setValue(next);
    force((n) => n + 1);
  }, [value]);

  const undo = useCallback(() => {
    if (!past.current.length) return;
    const previous = past.current[past.current.length - 1];
    past.current = past.current.slice(0, -1);
    future.current = [value, ...future.current];
    setValue(previous);
    force((n) => n + 1);
  }, [value]);

  const redo = useCallback(() => {
    if (!future.current.length) return;
    const next = future.current[0];
    future.current = future.current.slice(1);
    past.current = [...past.current, value];
    setValue(next);
    force((n) => n + 1);
  }, [value]);

  return {
    value,
    change,
    replace,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

// Write Application — type → recipient → details → generate → edit → export.
// The applicant's verified details are fetched from the server and only ever
// shown; they are never typed here, so they cannot be changed.
export default function WriteApplication() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const existingId = searchParams.get('id') || '';

  const editor = useUndoableText('');
  const textareaRef = useRef(null);

  const [application, setApplication] = useState(null);
  const [form, setForm] = useState({
    applicationType: '', recipientId: '', subject: '', details: '', additionalInfo: '',
  });
  const [structured, setStructured] = useState({});
  const [busy, setBusy] = useState('');
  const [suggestions, setSuggestions] = useState([]);

  const { data: typesData } = useQuery({ queryKey: ['application-types'], queryFn: applicationApi.types });
  const { data: recipientsData } = useQuery({ queryKey: ['application-recipients'], queryFn: applicationApi.recipients });
  const { data: creditsData } = useQuery({ queryKey: ['ai-credits'], queryFn: applicationApi.summary });
  const { data: aiData } = useQuery({ queryKey: ['application-ai-status'], queryFn: applicationApi.aiStatus });
  const { data: existingData } = useQuery({
    queryKey: ['application', existingId],
    queryFn: () => applicationApi.get(existingId),
    enabled: Boolean(existingId),
  });

  const types = typesData?.data || [];
  const recipients = recipientsData?.data || [];
  const credits = creditsData?.data;
  const ai = aiData?.data;
  const selectedType = useMemo(
    () => types.find((type) => type.key === form.applicationType),
    [types, form.applicationType]
  );
  const noCredits = Boolean(credits?.creditsEnabled) && (credits?.balance ?? 0) <= 0;

  // Load an application being reopened.
  useEffect(() => {
    const found = existingData?.data;
    if (!found) return;
    setApplication(found);
    setForm({
      applicationType: found.applicationType || '',
      recipientId: found.recipient?.recipient || '',
      subject: found.subject || '',
      details: found.details || '',
      additionalInfo: found.additionalInfo || '',
    });
    setStructured(found.structuredData || {});
    setSuggestions(found.suggestions || []);
    editor.replace(found.editedContent || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingData]);

  // The transparency preview — the blocks that will actually be used.
  const { data: previewData } = useQuery({
    queryKey: ['application-preview', form.recipientId],
    queryFn: () => applicationApi.profilePreview(form.recipientId || undefined),
  });
  const preview = previewData?.data;

  const invalidateCredits = () => qc.invalidateQueries({ queryKey: ['ai-credits'] });

  const payload = () => ({
    applicationType: form.applicationType,
    recipientId: form.recipientId,
    subject: form.subject,
    details: form.details,
    additionalInfo: form.additionalInfo,
    structuredData: structured,
  });

  const validate = () => {
    if (!form.applicationType) return 'Choose an application type';
    if (!form.recipientId) return 'Choose a recipient';
    if (!form.subject.trim()) return 'Enter a subject';
    if (!form.details.trim()) return 'Describe your application';
    return '';
  };

  const generate = async () => {
    const problem = validate();
    if (problem) return toast(problem, 'error');
    if (noCredits) return toast('You have no AI credits left this month.', 'error');

    setBusy('generate');
    try {
      const res = await applicationApi.generate(payload());
      const created = res.data;
      setApplication(created);
      editor.replace(created.editedContent || '');
      setSuggestions(created.suggestions || []);
      toast('Application generated. Review and edit it before exporting.', 'success');
      invalidateCredits();
      qc.invalidateQueries({ queryKey: ['applications'] });
    } catch (err) {
      toast(err.response?.data?.message || "We couldn't generate the application right now. Please try again.", 'error');
    } finally {
      setBusy('');
    }
  };

  const runAiAction = async (action) => {
    if (!application?.id) return toast('Generate or save the application first', 'error');
    setBusy(action);
    try {
      const res = await applicationApi.aiEdit({ applicationId: application.id, action, content: editor.value });
      setApplication(res.data);
      editor.replace(res.data.editedContent || '');
      toast('Application updated', 'success');
      invalidateCredits();
    } catch (err) {
      toast(err.response?.data?.message || 'That edit could not be applied', 'error');
    } finally {
      setBusy('');
    }
  };

  const fetchSuggestions = async () => {
    if (!application?.id) return toast('Generate or save the application first', 'error');
    setBusy('suggest');
    try {
      const res = await applicationApi.suggestions({ applicationId: application.id, content: editor.value });
      setSuggestions(res.data?.suggestions || []);
    } catch (err) {
      toast(err.response?.data?.message || 'Could not fetch suggestions', 'error');
    } finally {
      setBusy('');
    }
  };

  const saveDraft = async () => {
    setBusy('save');
    try {
      const res = application?.id
        ? await applicationApi.update(application.id, { ...payload(), editedContent: editor.value })
        : await applicationApi.create(payload());
      setApplication(res.data);
      toast('Draft saved', 'success');
      qc.invalidateQueries({ queryKey: ['applications'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Could not save the draft', 'error');
    } finally {
      setBusy('');
    }
  };

  const saveVersion = async () => {
    if (!application?.id) return toast('Save the application first', 'error');
    setBusy('version');
    try {
      await applicationApi.saveVersion(application.id, { content: editor.value });
      toast('Version saved', 'success');
    } catch (err) {
      toast(err.response?.data?.message || 'Could not save the version', 'error');
    } finally {
      setBusy('');
    }
  };

  const exportFile = async (fileType) => {
    if (!application?.id) return toast('Save the application first', 'error');
    setBusy(fileType);
    try {
      // Persist the current edits first, so the file matches what is on screen.
      await applicationApi.update(application.id, { editedContent: editor.value });
      const res = fileType === 'PDF'
        ? await applicationApi.generatePdf(application.id)
        : await applicationApi.generateDocx(application.id);
      await applicationApi.downloadExport(res.data.id);
      toast(`${fileType} generated. It stays available for 24 hours.`, 'success');
      qc.invalidateQueries({ queryKey: ['applications'] });
    } catch (err) {
      toast(err.response?.data?.message || `Could not generate the ${fileType}`, 'error');
    } finally {
      setBusy('');
    }
  };

  const copyAll = async () => {
    try {
      await navigator.clipboard.writeText(editor.value);
      toast('Copied', 'success');
    } catch {
      toast('Copy failed', 'error');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <Link to="/my-applications" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-700 mb-4">
        <ArrowLeft size={15} /> My Applications
      </Link>

      <h1 className="text-2xl font-bold text-slate-800">Write Application</h1>
      <p className="text-sm text-slate-500 mt-1 mb-5">
        Describe what you need in your own words — the AI drafts a formal letter using your verified details.
      </p>

      <CreditBadge />

      {ai && !ai.enabled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-5 text-sm text-amber-800">
          AI generation is not configured on this server yet. You can still write and export an application manually.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-5">
        {/* ---- Application information ---- */}
        <div className="space-y-4">
          <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Application Type</label>
              <select
                value={form.applicationType}
                onChange={(e) => setForm({ ...form, applicationType: e.target.value })}
                className="input"
              >
                <option value="">Select a type…</option>
                {types.map((type) => <option key={type.key} value={type.key}>{type.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Recipient</label>
              <select
                value={form.recipientId}
                onChange={(e) => setForm({ ...form, recipientId: e.target.value })}
                className="input"
              >
                <option value="">Select a recipient…</option>
                {recipients.map((recipient) => (
                  <option key={recipient._id} value={recipient._id}>
                    {recipient.name}{recipient.office ? ` — ${recipient.office}` : ''}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-400 mt-1">Addressed from the university’s own recipient records — never invented.</p>
            </div>

            {selectedType?.fields?.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-100 pt-4">
                {selectedType.fields.map((field) => (
                  <div key={field.key} className={field.type === 'TEXTAREA' ? 'sm:col-span-2' : ''}>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      {field.label}{field.required && <span className="text-red-500"> *</span>}
                    </label>
                    {field.type === 'SELECT' ? (
                      <select
                        value={structured[field.key] || ''}
                        onChange={(e) => setStructured({ ...structured, [field.key]: e.target.value })}
                        className="input"
                      >
                        <option value="">Select…</option>
                        {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : field.type === 'BOOLEAN' ? (
                      <select
                        value={structured[field.key] || ''}
                        onChange={(e) => setStructured({ ...structured, [field.key]: e.target.value })}
                        className="input"
                      >
                        <option value="">Select…</option>
                        <option value="Yes">Yes</option>
                        <option value="No">No</option>
                      </select>
                    ) : (
                      <input
                        type={field.type === 'DATE' ? 'date' : field.type === 'NUMBER' ? 'number' : 'text'}
                        value={structured[field.key] || ''}
                        placeholder={field.placeholder || ''}
                        onChange={(e) => setStructured({ ...structured, [field.key]: e.target.value })}
                        className="input"
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Subject</label>
              <input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="Application for 50% Tuition Fee Reduction"
                className="input"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">What is your application about?</label>
              <textarea
                rows={6}
                value={form.details}
                onChange={(e) => setForm({ ...form, details: e.target.value })}
                placeholder="I am currently facing financial difficulties and would like to request a 50% reduction in my tuition fees for the current semester."
                className="input py-2"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Additional information or instructions <span className="text-slate-400">(optional)</span></label>
              <textarea
                rows={3}
                value={form.additionalInfo}
                onChange={(e) => setForm({ ...form, additionalInfo: e.target.value })}
                placeholder="Please make the application respectful and formal. Mention that this is urgent."
                className="input py-2"
              />
            </div>

            <button
              onClick={generate}
              disabled={busy === 'generate' || noCredits}
              className="w-full h-11 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {busy === 'generate' ? <Sparkles size={16} className="animate-pulse" /> : <Wand2 size={16} />}
              {busy === 'generate' ? 'Generating your application… Please wait.' : 'Generate Application'}
            </button>
            {noCredits && (
              <p className="text-xs text-red-600 text-center">
                No AI credits remaining this month. You can still write manually and export.
              </p>
            )}
          </section>
        </div>

        {/* ---- Applicant / context preview ---- */}
        <aside className="space-y-4">
          <section className="bg-white border border-slate-200 rounded-xl p-5">
            <h2 className="font-semibold text-slate-700 mb-3">Application Context</h2>
            {preview?.recipient && preview?.recipientRows?.length > 0 && (
              <>
                <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Application For</p>
                {preview.recipientRows.map((row) => (
                  <p key={row.label} className="text-sm text-slate-700">{row.value}</p>
                ))}
                <div className="border-t border-slate-100 my-3" />
              </>
            )}
            <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Applicant</p>
            {(preview?.applicantRows || []).map((row) => (
              <p key={row.label} className="text-sm text-slate-700">
                <span className="text-slate-400">{row.label}: </span>{row.value}
              </p>
            ))}
            <p className="text-[11px] text-slate-400 mt-3">
              Taken from your verified profile — locked, and never sent as something you can edit.
            </p>
          </section>
        </aside>
      </div>

      {/* ---- Editor ---- */}
      {application && (
        <section className="mt-6 bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="font-semibold text-slate-700 flex items-center gap-2">
              <FileText size={16} /> {application.aiContent ? 'AI Generated Version' : 'Application'}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={editor.undo} disabled={!editor.canUndo} className="p-2 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40" title="Undo"><Undo2 size={14} /></button>
              <button onClick={editor.redo} disabled={!editor.canRedo} className="p-2 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40" title="Redo"><Redo2 size={14} /></button>
              <button onClick={copyAll} className="p-2 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50" title="Copy"><Copy size={14} /></button>
              <button onClick={() => textareaRef.current?.select()} className="px-2.5 h-9 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">Select all</button>
              <button
                onClick={() => editor.replace(application.aiContent || '')}
                className="flex items-center gap-1.5 px-2.5 h-9 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
                title="Discard your edits and return to the AI version"
              >
                <RotateCcw size={13} /> Reset to AI version
              </button>
            </div>
          </div>

          <textarea
            ref={textareaRef}
            rows={16}
            value={editor.value}
            onChange={(e) => editor.change(e.target.value)}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-500"
          />

          <div className="flex flex-wrap gap-1.5 mt-3">
            {AI_ACTIONS.map((action) => (
              <button
                key={action.key}
                onClick={() => runAiAction(action.key)}
                disabled={Boolean(busy)}
                className="px-3 h-9 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-brand-50 hover:border-brand-300 disabled:opacity-50"
              >
                {busy === action.key ? 'Working…' : action.label}
              </button>
            ))}
            <button
              onClick={fetchSuggestions}
              disabled={Boolean(busy)}
              className="px-3 h-9 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-brand-50 hover:border-brand-300 disabled:opacity-50"
            >
              {busy === 'suggest' ? 'Thinking…' : 'Suggestions'}
            </button>
          </div>

          {suggestions.length > 0 && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-700 mb-2">AI Suggestions</p>
              <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                {suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}
              </ul>
              <p className="text-[11px] text-slate-400 mt-2">Informational only — they are not applied automatically.</p>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mt-5">
            <button onClick={saveDraft} disabled={Boolean(busy)} className="flex items-center gap-1.5 h-10 px-4 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Save size={15} /> {busy === 'save' ? 'Saving…' : 'Save Draft'}
            </button>
            <button onClick={saveVersion} disabled={Boolean(busy)} className="h-10 px-4 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {busy === 'version' ? 'Saving…' : 'Save Version'}
            </button>
            <button onClick={generate} disabled={Boolean(busy) || noCredits} className="flex items-center gap-1.5 h-10 px-4 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Wand2 size={15} /> Regenerate
            </button>
            <button onClick={() => exportFile('PDF')} disabled={Boolean(busy)} className="flex items-center gap-1.5 h-10 px-4 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
              <Download size={15} /> {busy === 'PDF' ? 'Preparing PDF…' : 'Generate PDF'}
            </button>
            <button onClick={() => exportFile('DOCX')} disabled={Boolean(busy)} className="flex items-center gap-1.5 h-10 px-4 rounded-lg border border-brand-300 text-brand-700 text-sm font-semibold hover:bg-brand-50 disabled:opacity-50">
              <FileType2 size={15} /> {busy === 'DOCX' ? 'Preparing Word document…' : 'Generate DOCX'}
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Regenerating uses another AI credit. PDF/DOCX generation is free, and each file stays downloadable for 24 hours.
          </p>
        </section>
      )}
    </div>
  );
}
