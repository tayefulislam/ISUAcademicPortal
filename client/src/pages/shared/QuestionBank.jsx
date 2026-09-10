import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, X, Search, FileUp, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import { questionApi, departmentApi, courseApi, chapterApi, topicApi, facultyApi } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import MathEditor from '../../components/MathEditor.jsx';
import MathText from '../../components/MathText.jsx';

const TYPE_LABELS = {
  mcq: 'Multiple Choice (single answer)',
  multi_select: 'Multiple Choice (multiple answers)',
  true_false: 'True / False',
  short_answer: 'Short Answer',
  long_answer: 'Long Answer',
  fill_blank: 'Fill in the Blank',
  matching: 'Matching',
  numerical: 'Numerical',
};

const DIFFICULTY_STYLE = {
  easy: 'bg-emerald-50 text-emerald-700',
  medium: 'bg-amber-50 text-amber-700',
  hard: 'bg-red-50 text-red-600',
};

const emptyForm = {
  department: '',
  course: '',
  chapter: '',
  topic: '',
  type: 'mcq',
  text: '',
  explanation: '',
  defaultMarks: 1,
  options: [{ text: '', isCorrect: false }, { text: '', isCorrect: false }],
  correctTextAnswers: [''],
  matchingPairs: [{ left: '', right: '' }, { left: '', right: '' }],
  numericalAnswer: '',
  numericalTolerance: 0,
  visibility: 'private',
  difficulty: 'medium',
  tags: '',
  negativeMarks: 0,
};

export default function QuestionBank() {
  const { user, isFaculty, isSuperAdminTier } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [image, setImage] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [difficultyFilter, setDifficultyFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [showImport, setShowImport] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: allDepartments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list, enabled: !isFaculty });
  const { data: facultyCourses } = useQuery({ queryKey: ['faculty-courses'], queryFn: facultyApi.courses, enabled: isFaculty });
  const { data: allCourses } = useQuery({
    queryKey: ['courses', form.department],
    queryFn: () => courseApi.list({ department: form.department, limit: 200 }),
    enabled: !isFaculty && !!form.department,
  });
  const courses = isFaculty ? { data: (facultyCourses?.data || []).filter((c) => !form.department || c.department._id === form.department) } : allCourses;
  const departmentOptions = isFaculty
    ? [...new Map((facultyCourses?.data || []).map((c) => [c.department._id, c.department])).values()]
    : allDepartments?.data;

  const { data: chapters } = useQuery({ queryKey: ['chapters', form.course], queryFn: () => chapterApi.list({ course: form.course }), enabled: !!form.course });
  const { data: topics } = useQuery({ queryKey: ['topics', form.chapter], queryFn: () => topicApi.list({ chapter: form.chapter }), enabled: !!form.chapter });

  // 300ms debounce (per the search UX spec) — the underlying `q` param is
  // already typo-tolerant/fuzzy server-side (server/src/utils/textSearch.js),
  // so "quetion"/"qution"/"que" etc. still find "question".
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data, isLoading } = useQuery({
    queryKey: ['question-bank', form.department, form.course, debouncedSearch, difficultyFilter, tagFilter],
    queryFn: () =>
      questionApi.list({
        department: form.department || undefined,
        course: form.course || undefined,
        q: debouncedSearch || undefined,
        difficulty: difficultyFilter || undefined,
        tags: tagFilter || undefined,
        limit: 100,
      }),
    enabled: !!form.department,
  });

  // "Did you mean" — a lightweight parallel call to the richer /search
  // endpoint purely for its spelling-correction field; the actual result
  // cards above still come from the same fuzzy-aware `list` call, so this
  // never blocks or replaces the main results, only adds an optional banner.
  const { data: searchMeta } = useQuery({
    queryKey: ['question-bank-suggestion', form.department, form.course, debouncedSearch],
    queryFn: () => questionApi.search({ department: form.department || undefined, course: form.course || undefined, q: debouncedSearch, limit: 1 }),
    enabled: !!form.department && debouncedSearch.trim().length >= 2,
  });

  const setOption = (idx, key, val) =>
    setForm((f) => ({
      ...f,
      options: f.options.map((o, i) => {
        if (i !== idx) {
          // mcq/true_false: selecting one option's isCorrect clears the others.
          if (key === 'isCorrect' && val && ['mcq', 'true_false'].includes(f.type)) return { ...o, isCorrect: false };
          return o;
        }
        return { ...o, [key]: val };
      }),
    }));
  const addOption = () => setForm((f) => ({ ...f, options: [...f.options, { text: '', isCorrect: false }] }));
  const removeOption = (idx) => setForm((f) => ({ ...f, options: f.options.filter((_, i) => i !== idx) }));

  const setTextAnswer = (idx, val) => setForm((f) => ({ ...f, correctTextAnswers: f.correctTextAnswers.map((a, i) => (i === idx ? val : a)) }));
  const addTextAnswer = () => setForm((f) => ({ ...f, correctTextAnswers: [...f.correctTextAnswers, ''] }));
  const removeTextAnswer = (idx) => setForm((f) => ({ ...f, correctTextAnswers: f.correctTextAnswers.filter((_, i) => i !== idx) }));

  const setPair = (idx, key, val) => setForm((f) => ({ ...f, matchingPairs: f.matchingPairs.map((p, i) => (i === idx ? { ...p, [key]: val } : p)) }));
  const addPair = () => setForm((f) => ({ ...f, matchingPairs: [...f.matchingPairs, { left: '', right: '' }] }));
  const removePair = (idx) => setForm((f) => ({ ...f, matchingPairs: f.matchingPairs.filter((_, i) => i !== idx) }));

  const resetForm = () => {
    setForm((f) => ({ ...emptyForm, department: f.department, course: f.course }));
    setImage(null);
    setEditingId(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    try {
      const fd = new FormData();
      fd.append('department', form.department);
      fd.append('course', form.course);
      if (form.chapter) fd.append('chapter', form.chapter);
      if (form.topic) fd.append('topic', form.topic);
      fd.append('type', form.type);
      fd.append('text', form.text);
      fd.append('explanation', form.explanation);
      fd.append('defaultMarks', form.defaultMarks);
      fd.append('visibility', form.visibility);
      fd.append('difficulty', form.difficulty);
      fd.append('tags', form.tags);
      fd.append('negativeMarks', form.negativeMarks || 0);
      if (['mcq', 'multi_select', 'true_false'].includes(form.type)) fd.append('options', JSON.stringify(form.options.filter((o) => o.text)));
      if (['short_answer', 'fill_blank'].includes(form.type)) fd.append('correctTextAnswers', JSON.stringify(form.correctTextAnswers.filter(Boolean)));
      if (form.type === 'matching') fd.append('matchingPairs', JSON.stringify(form.matchingPairs.filter((p) => p.left && p.right)));
      if (form.type === 'numerical') {
        fd.append('numericalAnswer', form.numericalAnswer);
        fd.append('numericalTolerance', form.numericalTolerance);
      }
      if (image) fd.append('image', image);

      if (editingId) {
        await questionApi.update(editingId, fd);
        toast('Question updated', 'success');
      } else {
        await questionApi.create(fd);
        toast('Question added to the bank', 'success');
      }
      resetForm();
      qc.invalidateQueries({ queryKey: ['question-bank'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Save failed', 'error');
    }
  };

  const edit = (q) => {
    setEditingId(q._id);
    setForm({
      department: q.department._id,
      course: q.course._id,
      chapter: q.chapter?._id || '',
      topic: q.topic?._id || '',
      type: q.type,
      text: q.text,
      explanation: q.explanation || '',
      defaultMarks: q.defaultMarks,
      options: q.options?.length ? q.options : emptyForm.options,
      correctTextAnswers: q.correctTextAnswers?.length ? q.correctTextAnswers : [''],
      matchingPairs: q.matchingPairs?.length ? q.matchingPairs : emptyForm.matchingPairs,
      numericalAnswer: q.numericalAnswer ?? '',
      numericalTolerance: q.numericalTolerance || 0,
      visibility: q.visibility || 'private',
      difficulty: q.difficulty || 'medium',
      tags: (q.tags || []).join(', '),
      negativeMarks: q.negativeMarks || 0,
    });
  };

  const isOwner = (q) => String(q.createdBy?._id || q.createdBy) === String(user?._id);

  const remove = async (id) => {
    if (!confirm('Delete this question?')) return;
    try {
      await questionApi.remove(id);
      toast('Question deleted', 'success');
      qc.invalidateQueries({ queryKey: ['question-bank'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed', 'error');
    }
  };

  const questions = data?.data || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h1 className="text-2xl font-bold text-slate-800">Question Bank</h1>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            disabled={!form.course}
            title={!form.course ? 'Pick a Department and Course first' : 'Bulk-import questions from a .docx file'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <FileUp size={15} /> Import DOCX
          </button>
        </div>
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <select required value={form.department} onChange={(e) => setForm((f) => ({ ...emptyForm, department: e.target.value }))} className="input">
              <option value="">Department</option>
              {(departmentOptions || []).map((d) => <option key={d._id} value={d._id}>{d.code}</option>)}
            </select>
            <select required value={form.course} onChange={(e) => setForm((f) => ({ ...f, course: e.target.value }))} className="input" disabled={!form.department}>
              <option value="">Course</option>
              {(courses?.data || []).map((c) => <option key={c._id} value={c._id}>{c.courseId}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select value={form.chapter} onChange={(e) => setForm((f) => ({ ...f, chapter: e.target.value, topic: '' }))} className="input" disabled={!form.course}>
              <option value="">Chapter (optional)</option>
              {(chapters?.data || []).map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
            </select>
            <select value={form.topic} onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))} className="input" disabled={!form.chapter}>
              <option value="">Topic (optional)</option>
              {(topics?.data || []).map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
            </select>
          </div>

          <select value={form.type} onChange={(e) => setForm((f) => ({ ...emptyForm, department: f.department, course: f.course, chapter: f.chapter, topic: f.topic, type: e.target.value }))} className="input">
            {Object.entries(TYPE_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Question Text</label>
            <MathEditor
              value={form.text}
              onChange={(v) => setForm((f) => ({ ...f, text: v }))}
              placeholder={form.type === 'fill_blank' ? 'Mark each blank with ___ (three underscores), e.g. The capital of France is ___.' : 'Enter the question...'}
            />
            {form.type === 'fill_blank' && <p className="text-xs text-amber-600 mt-1">Use ___ (three underscores) to mark each blank.</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Question Image (optional)</label>
            <input type="file" accept="image/*" onChange={(e) => setImage(e.target.files?.[0] || null)} className="input" />
          </div>

          {['mcq', 'multi_select', 'true_false'].includes(form.type) && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Options — check the correct one(s)</label>
              <div className="space-y-2">
                {form.options.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type={form.type === 'multi_select' ? 'checkbox' : 'radio'} checked={o.isCorrect} onChange={(e) => setOption(i, 'isCorrect', e.target.checked)} />
                    <input value={o.text} onChange={(e) => setOption(i, 'text', e.target.value)} placeholder={`Option ${i + 1}`} className="input flex-1" />
                    {form.options.length > 2 && form.type !== 'true_false' && (
                      <button type="button" onClick={() => removeOption(i)} className="text-slate-400 hover:text-red-600"><X size={16} /></button>
                    )}
                  </div>
                ))}
              </div>
              {form.type !== 'true_false' && (
                <button type="button" onClick={addOption} className="text-xs text-brand-600 hover:underline mt-1.5">+ Add option</button>
              )}
            </div>
          )}

          {['short_answer', 'fill_blank'].includes(form.type) && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">
                {form.type === 'fill_blank' ? 'Accepted answer per blank, in order' : 'Accepted answer(s)'}
              </label>
              <div className="space-y-2">
                {form.correctTextAnswers.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={a} onChange={(e) => setTextAnswer(i, e.target.value)} placeholder={`Answer ${i + 1}`} className="input flex-1" />
                    {form.correctTextAnswers.length > 1 && (
                      <button type="button" onClick={() => removeTextAnswer(i)} className="text-slate-400 hover:text-red-600"><X size={16} /></button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={addTextAnswer} className="text-xs text-brand-600 hover:underline mt-1.5">+ Add answer</button>
            </div>
          )}

          {form.type === 'matching' && (
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Matching pairs</label>
              <div className="space-y-2">
                {form.matchingPairs.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input value={p.left} onChange={(e) => setPair(i, 'left', e.target.value)} placeholder="Left" className="input flex-1" />
                    <input value={p.right} onChange={(e) => setPair(i, 'right', e.target.value)} placeholder="Right" className="input flex-1" />
                    {form.matchingPairs.length > 2 && (
                      <button type="button" onClick={() => removePair(i)} className="text-slate-400 hover:text-red-600"><X size={16} /></button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={addPair} className="text-xs text-brand-600 hover:underline mt-1.5">+ Add pair</button>
            </div>
          )}

          {form.type === 'numerical' && (
            <div className="grid grid-cols-2 gap-2">
              <input required type="number" step="any" value={form.numericalAnswer} onChange={(e) => setForm((f) => ({ ...f, numericalAnswer: e.target.value }))} placeholder="Correct value" className="input" />
              <input type="number" step="any" min={0} value={form.numericalTolerance} onChange={(e) => setForm((f) => ({ ...f, numericalTolerance: e.target.value }))} placeholder="Tolerance (±)" className="input" />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Explanation (optional, shown with correct answer)</label>
            <MathEditor value={form.explanation} onChange={(v) => setForm((f) => ({ ...f, explanation: v }))} rows={2} />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <input required type="number" min={0} value={form.defaultMarks} onChange={(e) => setForm((f) => ({ ...f, defaultMarks: e.target.value }))} placeholder="Default marks" className="input" />
            <select value={form.difficulty} onChange={(e) => setForm((f) => ({ ...f, difficulty: e.target.value }))} className="input">
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <input
              type="number"
              min={0}
              step="any"
              value={form.negativeMarks}
              onChange={(e) => setForm((f) => ({ ...f, negativeMarks: e.target.value }))}
              placeholder="Negative marks"
              title="Marks deducted if this question is answered wrong (0 = use the exam's default)"
              className="input"
            />
          </div>
          <input
            value={form.tags}
            onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
            placeholder="Tags, comma separated (e.g. algorithms, recursion)"
            className="input"
          />

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Visibility</label>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="radio" name="visibility" checked={form.visibility === 'private'} onChange={() => setForm((f) => ({ ...f, visibility: 'private' }))} />
                Private (only you can view/use/edit)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" name="visibility" checked={form.visibility === 'public'} onChange={() => setForm((f) => ({ ...f, visibility: 'public' }))} />
                Public (other faculty can view/use, not edit)
              </label>
            </div>
          </div>

          <button disabled={!form.course} className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
            <Plus size={16} /> {editingId ? 'Update' : 'Add'} Question
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="w-full h-9 text-sm text-slate-500">Cancel edit</button>
          )}
        </form>
      </div>

      <div className="lg:col-span-2 space-y-2">
        {form.department && (
          <div className="flex flex-wrap gap-2 mb-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search questions by text..."
              className="input flex-1 min-w-[160px]"
            />
            <select value={difficultyFilter} onChange={(e) => setDifficultyFilter(e.target.value)} className="input" style={{ width: 140 }}>
              <option value="">All difficulties</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <input
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              placeholder="Filter by tag..."
              className="input"
              style={{ width: 160 }}
            />
          </div>
        )}
        {searchMeta?.suggestion && searchMeta.suggestion !== debouncedSearch.trim().toLowerCase() && (
          <button
            type="button"
            onClick={() => setSearch(searchMeta.suggestion)}
            className="flex items-center gap-1.5 text-xs text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 mb-2 hover:bg-brand-100"
          >
            <Search size={12} /> Did you mean <strong>"{searchMeta.suggestion}"</strong>?
          </button>
        )}
        {!form.department ? (
          <p className="text-slate-400">Pick a department to browse its question bank.</p>
        ) : isLoading ? (
          <p className="text-slate-400">Loading...</p>
        ) : questions.length === 0 ? (
          <p className="text-slate-400">No questions yet for this scope.</p>
        ) : (
          questions.map((q) => (
            <div key={q._id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-xs font-medium text-brand-600">{TYPE_LABELS[q.type]}</span>
                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${q.visibility === 'public' ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                    {q.visibility === 'public' ? 'Public' : 'Private'}
                  </span>
                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${DIFFICULTY_STYLE[q.difficulty] || DIFFICULTY_STYLE.medium}`}>
                    {q.difficulty || 'medium'}
                  </span>
                  <MathText text={q.text} className="block text-slate-700 mt-0.5" />
                  {q.tags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {q.tags.map((t) => (
                        <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border border-slate-200">#{t}</span>
                      ))}
                    </div>
                  )}
                  {q.imageUrl && <img src={q.imageUrl} alt="" className="max-h-32 rounded-lg mt-2" />}
                </div>
                <span className="shrink-0 text-xs text-slate-400">{q.defaultMarks} marks</span>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {q.course?.courseId} {q.chapterName || q.chapter?.name} {q.topic?.name && `· ${q.topic.name}`}
                {!isOwner(q) && q.createdBy?.name && ` · by ${q.createdBy.name}`}
              </p>
              {isOwner(q) || isSuperAdminTier ? (
                <div className="flex gap-2 mt-2">
                  <button onClick={() => edit(q)} className="p-1.5 rounded hover:bg-slate-100"><Pencil size={16} /></button>
                  <button onClick={() => remove(q._id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={16} /></button>
                </div>
              ) : (
                <p className="text-xs text-slate-400 mt-2 italic">Shared by another faculty — view only</p>
              )}
            </div>
          ))
        )}
      </div>

      {showImport && (
        <ImportDocxModal
          department={form.department}
          course={form.course}
          chapter={form.chapter}
          topic={form.topic}
          onClose={() => setShowImport(false)}
          onImported={() => qc.invalidateQueries({ queryKey: ['question-bank'] })}
        />
      )}

      <style>{`.input { width: 100%; height: 2.5rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; }
      .input:disabled { background-color: #f1f5f9; color: #94a3b8; }`}</style>
    </div>
  );
}

// Bulk-imports questions parsed out of a .docx file (server/src/utils/
// docxQuestionParser.js) into the Department/Course/Chapter/Topic already
// selected in the main form — that scope can't be inferred from the
// document itself, so it's carried over rather than asked twice. Malformed
// individual questions are skipped with a reason rather than failing the
// whole batch (see importQuestionsFromDocx in questionController.js); the
// result view lists both so a faculty member knows exactly what landed and
// what to fix before re-uploading just the leftovers.
function ImportDocxModal({ department, course, chapter, topic, onClose, onImported }) {
  const [file, setFile] = useState(null);
  const [visibility, setVisibility] = useState('private');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const { toast } = useToast();

  const submit = async (e) => {
    e.preventDefault();
    if (!file) return toast('Please choose a .docx file', 'error');
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('department', department);
      fd.append('course', course);
      if (chapter) fd.append('chapter', chapter);
      if (topic) fd.append('topic', topic);
      fd.append('visibility', visibility);
      fd.append('file', file);
      const res = await questionApi.importDocx(fd);
      setResult(res.data);
      if (res.data.created.length) {
        toast(res.message, 'success');
        onImported();
      } else {
        toast(res.message, 'error');
      }
    } catch (err) {
      toast(err.response?.data?.message || 'Import failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-lg w-full p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800">Import Questions from DOCX</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100"><X size={18} /></button>
        </div>

        {!result ? (
          <form onSubmit={submit} className="space-y-3">
            <p className="text-xs text-slate-500">
              Every question in the file starts with a line like <code>Q1.</code>, followed by options (
              <code>A) text</code>, mark the correct one with a trailing <code>*</code>) or an <code>Answer:</code>{' '}
              line. An optional <code>Type:</code> line picks the question type explicitly when it can't be guessed
              from context (e.g. <code>long_answer</code>).
            </p>
            <a
              href="/templates/question-import-example.docx"
              download
              className="flex items-center gap-1.5 text-sm text-brand-600 hover:underline"
            >
              <Download size={14} /> Download an example .docx (covers every question type)
            </a>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">.docx file</label>
              <input
                required
                type="file"
                accept=".docx"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="input"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Visibility for all imported questions</label>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="import-visibility" checked={visibility === 'private'} onChange={() => setVisibility('private')} />
                  Private
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" name="import-visibility" checked={visibility === 'public'} onChange={() => setVisibility('public')} />
                  Public
                </label>
              </div>
            </div>

            <button disabled={submitting} className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold disabled:opacity-60">
              {submitting ? 'Importing...' : 'Import'}
            </button>
          </form>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 text-sm">
              <CheckCircle2 size={16} className="shrink-0" />
              {result.created.length} of {result.total} question(s) imported.
            </div>

            {result.skipped.length > 0 && (
              <div>
                <p className="flex items-center gap-1.5 text-sm font-medium text-amber-700 mb-1.5">
                  <AlertTriangle size={15} /> {result.skipped.length} skipped
                </p>
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {result.skipped.map((s) => (
                    <div key={s.index} className="text-xs bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                      <span className="font-medium text-amber-800">#{s.index}</span>{' '}
                      <span className="text-slate-500 truncate">{s.text}</span>
                      <p className="text-amber-700 mt-0.5">{s.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button onClick={onClose} className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
