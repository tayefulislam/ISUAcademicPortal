import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Copy, Download, FileText, FileType2, Loader2, Redo2, RotateCcw, Save, Sparkles, Undo2, Wand2,
} from 'lucide-react';
import { applicationApi } from '../api/endpoints.js';
import { trackClarityEvent } from '../analytics/clarity.js';
import { useToast } from '../context/ToastContext.jsx';
import CreditBadge from '../components/CreditBadge.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';

const AI_ACTIONS = [
  { key: 'formal', label: 'More formal' },
  { key: 'shorter', label: 'Shorter' },
  { key: 'detailed', label: 'More detailed' },
  { key: 'grammar', label: 'Fix grammar' },
  { key: 'rewrite', label: 'Rewrite' },
  { key: 'respectful', label: 'Respectful' },
  { key: 'trim', label: 'Trim' },
];

function SectionTitle({ step, children }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
      {step && (
        <span className="w-6 h-6 rounded-full bg-brand-50 text-brand-700 text-xs font-bold grid place-items-center shrink-0">
          {step}
        </span>
      )}
      {children}
    </h2>
  );
}

/** A text field that remembers edits and offers undo/redo, coalesced by time. */
function useUndoableText(initial = '') {
  const [value, setValue] = useState(initial);
  const past = useRef([]);
  const future = useRef([]);
  const lastAt = useRef(0);
  const [, force] = useState(0);

  const change = useCallback((next) => {
    const now = Date.now();
    if (now - lastAt.current > 700 && value !== next) {
      past.current = [...past.current.slice(-99), value];
      future.current = [];
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
    value, change, replace, undo, redo,
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

  useEffect(() => {
    trackClarityEvent('application_started');
  }, []);

  const typesQuery = useQuery({ queryKey: ['application-types'], queryFn: applicationApi.types });
  const recipientsQuery = useQuery({ queryKey: ['application-recipients'], queryFn: applicationApi.recipients });
  const { data: creditsData } = useQuery({ queryKey: ['ai-credits'], queryFn: applicationApi.summary });
  const { data: aiData } = useQuery({ queryKey: ['application-ai-status'], queryFn: applicationApi.aiStatus });
  const { data: existingData } = useQuery({
    queryKey: ['application', existingId],
    queryFn: () => applicationApi.get(existingId),
    enabled: Boolean(existingId),
  });

  const types = typesQuery.data?.data || [];
  const recipients = recipientsQuery.data?.data || [];
  const credits = creditsData?.data;
  const ai = aiData?.data;
  const selectedType = useMemo(
    () => types.find((type) => type.key === form.applicationType),
    [types, form.applicationType]
  );
  const noCredits = Boolean(credits?.creditsEnabled) && (credits?.balance ?? 0) <= 0;

  const typeOptions = useMemo(
    () => types.map((type) => ({ value: type.key, label: type.name })),
    [types]
  );
  // Long recipient lists are the norm, and two recipients can share a name —
  // the office/designation disambiguates them.
  const recipientOptions = useMemo(
    () => recipients.map((recipient) => ({
      value: recipient._id,
      label: [recipient.name, recipient.office || recipient.designation].filter(Boolean).join(' — '),
    })),
    [recipients]
  );

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
      trackClarityEvent('application_submitted');
      toast('Saved', 'success');
      qc.invalidateQueries({ queryKey: ['applications'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Could not save', 'error');
    } finally {
      setBusy('');
    }
  };

  const exportFile = async (fileType) => {
    if (!application?.id) return toast('Save the application first', 'error');
    setBusy(fileType);
    try {
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

  const referenceError = typesQuery.isError || recipientsQuery.isError;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <Link to="/my-applications" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-brand-700 mb-3">
        <ArrowLeft size={15} /> My Applications
      </Link>

      <h1 className="text-xl sm:text-2xl font-bold text-slate-800">Write Application</h1>
      <p className="text-sm text-slate-500 mt-1 mb-5">
        Describe what you need in your own words — the AI drafts a formal letter using your verified details.
      </p>

      <CreditBadge />

      {ai && !ai.enabled && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 mb-5 text-sm text-amber-800">
          AI generation is not configured on this server yet. You can still write and export an application manually.
        </div>
      )}

      {referenceError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-5 text-sm text-red-700">
          We couldn’t load the application types and recipients. Please refresh the page — if it keeps happening, the
          server may not be running the latest version.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-5 items-start">
        {/* ---- Application information ---- */}
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-5">
          <div>
            <SectionTitle step="1">Application details</SectionTitle>
            <div className="space-y-4">
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">Application type</span>
                <SearchableSelect
                  value={form.applicationType}
                  onChange={(value) => setForm((f) => ({ ...f, applicationType: value }))}
                  options={typeOptions}
                  placeholder={typesQuery.isLoading ? 'Loading types…' : 'Select a type'}
                  searchPlaceholder="Search application types…"
                  disabled={typesQuery.isLoading}
                  heightClass="h-12 sm:h-11"
                />
                {!typesQuery.isLoading && types.length === 0 && !typesQuery.isError && (
                  <span className="block text-xs text-slate-400 mt-1">No application types are available yet.</span>
                )}
              </label>

              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">Recipient</span>
                <SearchableSelect
                  value={form.recipientId}
                  onChange={(value) => setForm((f) => ({ ...f, recipientId: value }))}
                  options={recipientOptions}
                  placeholder={recipientsQuery.isLoading ? 'Loading recipients…' : 'Select a recipient'}
                  searchPlaceholder="Search recipients…"
                  disabled={recipientsQuery.isLoading}
                  heightClass="h-12 sm:h-11"
                />
                <span className="block text-xs text-slate-400 mt-1">
                  {recipients.length > 0
                    ? 'Addressed from the university’s own recipient records — never invented.'
                    : recipientsQuery.isLoading ? ' ' : 'No recipients have been configured yet.'}
                </span>
              </label>
            </div>
          </div>

          {selectedType?.fields?.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
              <SectionTitle>About this type of application</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {selectedType.fields.map((field) => (
                  <div key={field.key} className={field.type === 'TEXTAREA' ? 'sm:col-span-2' : ''}>
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      {field.label}{field.required && <span className="text-red-500"> *</span>}
                    </label>
                    {field.type === 'SELECT' ? (
                      <select
                        value={structured[field.key] || ''}
                        onChange={(e) => setStructured({ ...structured, [field.key]: e.target.value })}
                        className="input h-12 sm:h-11"
                      >
                        <option value="">Select…</option>
                        {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    ) : field.type === 'BOOLEAN' ? (
                      <select
                        value={structured[field.key] || ''}
                        onChange={(e) => setStructured({ ...structured, [field.key]: e.target.value })}
                        className="input h-12 sm:h-11"
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
                        className="input h-12 sm:h-11"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="border-t border-slate-100 pt-4 space-y-4">
            <SectionTitle step="2">What to write</SectionTitle>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">Subject</span>
              <input
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
                placeholder="Application for 50% Tuition Fee Reduction"
                className="input h-12 sm:h-11"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">What is your application about?</span>
              <textarea
                rows={6}
                value={form.details}
                onChange={(e) => setForm({ ...form, details: e.target.value })}
                placeholder="I am currently facing financial difficulties and would like to request a 50% reduction in my tuition fees for the current semester."
                className="input py-2"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-600 mb-1">
                Additional information or instructions <span className="text-slate-400">(optional)</span>
              </span>
              <textarea
                rows={3}
                value={form.additionalInfo}
                onChange={(e) => setForm({ ...form, additionalInfo: e.target.value })}
                placeholder="Please make the application respectful and formal. Mention that this is urgent."
                className="input py-2"
              />
            </label>
          </div>

          <button
            onClick={generate}
            disabled={busy === 'generate' || noCredits}
            className="w-full h-12 sm:h-11 rounded-lg bg-brand-600 text-white font-semibold hover:bg-brand-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {busy === 'generate' ? <Loader2 size={17} className="animate-spin" /> : <Wand2 size={17} />}
            {busy === 'generate' ? 'Generating your application… Please wait.' : 'Generate Application'}
          </button>
          {noCredits && (
            <p className="text-xs text-red-600 text-center -mt-2">
              No AI credits remaining this month. You can still write manually and export.
            </p>
          )}
        </section>

        {/* ---- Applicant / context preview ---- */}
        <aside className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 lg:sticky lg:top-20">
          <SectionTitle>Application context</SectionTitle>
          {preview?.recipientRows?.length > 0 && (
            <>
              <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Application for</p>
              {preview.recipientRows.map((row) => (
                <p key={row.label} className="text-sm text-slate-700 break-words">{row.value}</p>
              ))}
              <div className="border-t border-slate-100 my-3" />
            </>
          )}
          <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-1">Applicant</p>
          {(preview?.applicantRows || []).length === 0 && (
            <p className="text-sm text-slate-400">Choose a recipient to see the details that will be used.</p>
          )}
          {(preview?.applicantRows || []).map((row) => (
            <p key={row.label} className="text-sm text-slate-700 break-words">
              <span className="text-slate-400">{row.label}: </span>{row.value}
            </p>
          ))}
          <p className="text-[11px] text-slate-400 mt-3">
            Taken from your verified profile — locked, and never sent as something you can edit.
          </p>
        </aside>
      </div>

      {/* ---- Editor ---- */}
      {application && (
        <section className="mt-5 bg-white border border-slate-200 rounded-xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <SectionTitle step="3">
              <span className="flex items-center gap-2">
                <FileText size={16} /> {application.aiContent ? 'AI generated version' : 'Application'}
              </span>
            </SectionTitle>
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={editor.undo} disabled={!editor.canUndo} className="p-2.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40" title="Undo"><Undo2 size={15} /></button>
              <button onClick={editor.redo} disabled={!editor.canRedo} className="p-2.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40" title="Redo"><Redo2 size={15} /></button>
              <button onClick={copyAll} className="p-2.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50" title="Copy"><Copy size={15} /></button>
              <button onClick={() => textareaRef.current?.select()} className="px-3 h-11 sm:h-9 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">Select all</button>
              <button
                onClick={() => editor.replace(application.aiContent || '')}
                className="flex items-center gap-1.5 px-3 h-11 sm:h-9 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
                title="Discard your edits and return to the AI version"
              >
                <RotateCcw size={14} /> Reset to AI version
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
                className="px-3 h-11 sm:h-9 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-brand-50 hover:border-brand-300 disabled:opacity-50 flex items-center gap-1.5"
              >
                {busy === action.key && <Loader2 size={12} className="animate-spin" />}
                {action.label}
              </button>
            ))}
            <button
              onClick={fetchSuggestions}
              disabled={Boolean(busy)}
              className="px-3 h-11 sm:h-9 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-brand-50 hover:border-brand-300 disabled:opacity-50 flex items-center gap-1.5"
            >
              {busy === 'suggest' ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={13} />} Suggestions
            </button>
          </div>

          {suggestions.length > 0 && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-700 mb-2">AI suggestions</p>
              <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                {suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}
              </ul>
              <p className="text-[11px] text-slate-400 mt-2">Informational only — they are not applied automatically.</p>
            </div>
          )}

          <div className="border-t border-slate-100 mt-5 pt-4">
            <SectionTitle step="4">Review &amp; export</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button onClick={saveDraft} disabled={Boolean(busy)} className="flex items-center justify-center gap-1.5 h-12 sm:h-11 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <Save size={16} /> {busy === 'save' ? 'Saving…' : 'Save'}
              </button>
              <button onClick={generate} disabled={Boolean(busy) || noCredits} className="flex items-center justify-center gap-1.5 h-12 sm:h-11 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                <Wand2 size={16} /> Regenerate
              </button>
              <button onClick={() => exportFile('PDF')} disabled={Boolean(busy)} className="flex items-center justify-center gap-1.5 h-12 sm:h-11 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
                {busy === 'PDF' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {busy === 'PDF' ? 'Preparing PDF…' : 'Generate PDF'}
              </button>
              <button onClick={() => exportFile('DOCX')} disabled={Boolean(busy)} className="flex items-center justify-center gap-1.5 h-12 sm:h-11 rounded-lg border border-brand-300 text-brand-700 text-sm font-semibold hover:bg-brand-50 disabled:opacity-50">
                {busy === 'DOCX' ? <Loader2 size={16} className="animate-spin" /> : <FileType2 size={16} />}
                {busy === 'DOCX' ? 'Preparing Word document…' : 'Generate DOCX'}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 mt-2">
              Regenerating uses another AI credit. PDF/DOCX generation is free, and each file stays downloadable for 24 hours.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
