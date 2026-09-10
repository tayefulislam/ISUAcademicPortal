import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Users, X, Globe, Link2, Ban } from 'lucide-react';
import { quizApi, questionApi, departmentApi, courseApi, batchApi, semesterApi, facultyApi } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { formatDate } from '../../utils/format.js';
import MathText from '../../components/MathText.jsx';
import QuizAttemptsPanel from './QuizAttemptsPanel.jsx';

const STATUS_STYLE = { draft: 'bg-slate-100 text-slate-600', published: 'bg-emerald-50 text-emerald-700', closed: 'bg-red-50 text-red-600' };

const emptyPublicAccess = {
  publicName: '',
  slug: '',
  passwordEnabled: false,
  password: '',
  participantFields: { name: 'required', email: 'optional', phone: 'disabled' },
  loginRequirement: 'guest',
  attemptLimit: { type: 'one', max: 1 },
  resultSettings: {
    visibility: 'immediate',
    showScore: true,
    showPercentage: true,
    showPassFail: true,
    showCorrectAnswers: false,
    showExplanations: false,
    showQuestionByQuestion: true,
  },
  disabled: false,
};

const emptyForm = {
  title: '',
  description: '',
  startAt: '',
  endAt: '',
  duration: 30,
  passingMarks: 0,
  attemptsAllowed: 1,
  randomizeQuestions: false,
  randomizeOptions: false,
  showResultImmediately: true,
  showCorrectAnswers: false,
  negativeMarkingEnabled: false,
  negativeMarkingValue: 0,
  status: 'draft',
  departments: [],
  courses: [],
  batches: [],
  semesters: [],
  examType: 'course',
  publicAccess: emptyPublicAccess,
  questionSelection: { mode: 'fixed', rules: [] },
};

const emptyRule = { course: '', difficulty: 'any', tags: '', count: 5, marksEach: 1 };

export default function QuizManager() {
  const { isFaculty } = useAuth();
  const [form, setForm] = useState(emptyForm);
  const [selectedQuestions, setSelectedQuestions] = useState([]); // [{question, marks}]
  const [bankDept, setBankDept] = useState('');
  const [bankCourse, setBankCourse] = useState('');
  const [bankSearch, setBankSearch] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [viewingAttempts, setViewingAttempts] = useState(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: allDepartments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list, enabled: !isFaculty });
  const { data: allCourses } = useQuery({ queryKey: ['all-courses'], queryFn: () => courseApi.list({ limit: 500 }), enabled: !isFaculty });
  const { data: facultyCourses } = useQuery({ queryKey: ['faculty-courses'], queryFn: facultyApi.courses, enabled: isFaculty });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });
  const { data, isLoading } = useQuery({ queryKey: ['my-quizzes'], queryFn: quizApi.mine });

  const courses = isFaculty ? facultyCourses : allCourses;
  const departmentOptions = isFaculty
    ? [...new Map((facultyCourses?.data || []).map((c) => [c.department._id, c.department])).values()]
    : allDepartments?.data;

  // Reuses the same typo-tolerant fuzzy search as Question Bank's own
  // search box (server/src/utils/textSearch.js, via the `q` param) — a
  // Faculty building an exam can type a misspelled/partial word here and
  // still find the right bank question.
  const debouncedBankSearch = useDebouncedValue(bankSearch, 300);
  const { data: bankQuestions } = useQuery({
    queryKey: ['question-bank-picker', bankDept, bankCourse, debouncedBankSearch],
    queryFn: () => questionApi.list({ department: bankDept, course: bankCourse, q: debouncedBankSearch || undefined, limit: 100 }),
    enabled: !!bankDept && !!bankCourse,
  });

  const toggleIn = (key) => (id) => setForm((f) => ({ ...f, [key]: f[key].includes(id) ? f[key].filter((x) => x !== id) : [...f[key], id] }));

  const addQuestion = (q) => {
    if (selectedQuestions.some((sq) => sq.question._id === q._id)) return;
    setSelectedQuestions((sq) => [...sq, { question: q, marks: q.defaultMarks }]);
  };
  const removeQuestion = (id) => setSelectedQuestions((sq) => sq.filter((s) => s.question._id !== id));
  const setQuestionMarks = (id, marks) => setSelectedQuestions((sq) => sq.map((s) => (s.question._id === id ? { ...s, marks: Number(marks) } : s)));

  const totalMarks = selectedQuestions.reduce((sum, s) => sum + (s.marks || 0), 0);

  const resetForm = () => {
    setForm(emptyForm);
    setSelectedQuestions([]);
    setEditingId(null);
  };

  const submit = async (e) => {
    e.preventDefault();
    const isPublic = form.examType === 'public';
    const isRandom = form.questionSelection.mode === 'random';
    if (!isPublic && !form.departments.length && !form.courses.length && !form.batches.length && !form.semesters.length) {
      return toast('Select at least one department, course, batch, or semester to target', 'error');
    }
    if (!isRandom && !selectedQuestions.length) return toast('Add at least one question', 'error');
    if (isRandom && !form.questionSelection.rules.length) return toast('Add at least one question-selection rule', 'error');
    if (isPublic && form.publicAccess.passwordEnabled && !form.publicAccess.password && !editingId) {
      return toast('Set a password, or turn off password protection', 'error');
    }

    const payload = {
      title: form.title,
      description: form.description,
      departments: form.departments,
      courses: form.courses,
      batches: form.batches,
      semesters: form.semesters,
      startAt: form.startAt,
      endAt: form.endAt,
      duration: form.duration,
      passingMarks: form.passingMarks,
      attemptsAllowed: form.attemptsAllowed,
      randomizeQuestions: form.randomizeQuestions,
      randomizeOptions: form.randomizeOptions,
      showResultImmediately: form.showResultImmediately,
      showCorrectAnswers: form.showCorrectAnswers,
      negativeMarking: { enabled: form.negativeMarkingEnabled, valuePerWrong: form.negativeMarkingValue },
      status: form.status,
      questions: isRandom ? [] : selectedQuestions.map((s, i) => ({ questionId: s.question._id, marks: s.marks, order: i })),
      questionSelection: isRandom
        ? {
            mode: 'random',
            rules: form.questionSelection.rules.map((r) => ({
              course: r.course,
              difficulty: r.difficulty,
              tags: r.tags ? r.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
              count: Number(r.count),
              marksEach: Number(r.marksEach),
            })),
          }
        : { mode: 'fixed', rules: [] },
      examType: form.examType,
      publicAccess: isPublic ? { ...form.publicAccess, enabled: true } : undefined,
    };

    try {
      if (editingId) {
        await quizApi.update(editingId, payload);
        toast('Quiz updated', 'success');
      } else {
        await quizApi.create(payload);
        toast(form.status === 'published' ? 'Quiz published' : 'Quiz saved as draft', 'success');
      }
      resetForm();
      qc.invalidateQueries({ queryKey: ['my-quizzes'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Save failed', 'error');
    }
  };

  const edit = async (quiz) => {
    try {
      const res = await quizApi.getForManage(quiz._id);
      const q = res.data;
      setEditingId(q._id);
      setForm({
        title: q.title,
        description: q.description || '',
        startAt: q.startAt?.slice(0, 16) || '',
        endAt: q.endAt?.slice(0, 16) || '',
        duration: q.duration,
        passingMarks: q.passingMarks,
        attemptsAllowed: q.attemptsAllowed,
        randomizeQuestions: q.randomizeQuestions,
        randomizeOptions: q.randomizeOptions,
        showResultImmediately: q.showResultImmediately,
        showCorrectAnswers: q.showCorrectAnswers,
        negativeMarkingEnabled: q.negativeMarking?.enabled || false,
        negativeMarkingValue: q.negativeMarking?.valuePerWrong || 0,
        status: q.status,
        departments: (q.departments || []).map((d) => d._id || d),
        courses: (q.courses || []).map((c) => c._id || c),
        batches: (q.batches || []).map((b) => b._id || b),
        semesters: (q.semesters || []).map((s) => s._id || s),
        examType: q.examType || 'course',
        publicAccess: q.publicAccess
          ? {
              ...emptyPublicAccess,
              ...q.publicAccess,
              password: '', // never pre-filled — a blank field means "keep the existing password"
              participantFields: { ...emptyPublicAccess.participantFields, ...q.publicAccess.participantFields },
              attemptLimit: { ...emptyPublicAccess.attemptLimit, ...q.publicAccess.attemptLimit },
              resultSettings: { ...emptyPublicAccess.resultSettings, ...q.publicAccess.resultSettings },
            }
          : emptyPublicAccess,
        questionSelection:
          q.questionSelection?.mode === 'random'
            ? {
                mode: 'random',
                rules: q.questionSelection.rules.map((r) => ({
                  course: r.course?._id || r.course,
                  difficulty: r.difficulty || 'any',
                  tags: (r.tags || []).join(', '),
                  count: r.count,
                  marksEach: r.marksEach,
                })),
              }
            : { mode: 'fixed', rules: [] },
      });
      setSelectedQuestions((q.questions || []).map((qq) => ({ question: qq.question, marks: qq.marks })));
    } catch (err) {
      toast(err.response?.data?.message || 'Could not load quiz for editing', 'error');
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this quiz? All attempts will be removed too.')) return;
    try {
      await quizApi.remove(id);
      toast('Quiz deleted', 'success');
      qc.invalidateQueries({ queryKey: ['my-quizzes'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Delete failed', 'error');
    }
  };

  const quizzes = data?.data || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Quizzes</h1>
        <form onSubmit={submit} className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Quiz title" className="input" />
          <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" className="input" />

          <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setForm({ ...form, examType: 'course' })}
              className={`flex-1 h-9 rounded-md text-sm font-medium ${form.examType === 'course' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
            >
              Course Exam
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, examType: 'public' })}
              className={`flex-1 h-9 rounded-md text-sm font-medium flex items-center justify-center gap-1.5 ${form.examType === 'public' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
            >
              <Globe size={14} /> Public Exam
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Start</label>
              <input required type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} className="input" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">End</label>
              <input required type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} className="input" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <input required type="number" min={1} value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} placeholder="Duration (min)" className="input" />
            <input type="number" min={0} value={form.passingMarks} onChange={(e) => setForm({ ...form, passingMarks: e.target.value })} placeholder="Passing marks" className="input" />
            <input type="number" min={1} value={form.attemptsAllowed} onChange={(e) => setForm({ ...form, attemptsAllowed: e.target.value })} placeholder="Attempts" className="input" />
          </div>

          <div className="space-y-1.5 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.randomizeQuestions} onChange={(e) => setForm({ ...form, randomizeQuestions: e.target.checked })} /> Randomize question order</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.randomizeOptions} onChange={(e) => setForm({ ...form, randomizeOptions: e.target.checked })} /> Randomize option order</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.showResultImmediately} onChange={(e) => setForm({ ...form, showResultImmediately: e.target.checked })} /> Show result immediately after submit</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.showCorrectAnswers} onChange={(e) => setForm({ ...form, showCorrectAnswers: e.target.checked })} /> Show correct answers after submit</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={form.negativeMarkingEnabled} onChange={(e) => setForm({ ...form, negativeMarkingEnabled: e.target.checked })} /> Negative marking</label>
            {form.negativeMarkingEnabled && (
              <input type="number" min={0} step="any" value={form.negativeMarkingValue} onChange={(e) => setForm({ ...form, negativeMarkingValue: e.target.value })} placeholder="Marks deducted per wrong answer" className="input" />
            )}
          </div>

          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className="input">
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="closed">Closed</option>
          </select>

          {form.examType === 'course' ? (
            <div className="space-y-3 border border-slate-200 rounded-lg p-3">
              <p className="text-xs text-slate-500">Target the exact class — all selected axes must match together.</p>
              <PickGroup label="Department" items={departmentOptions} value={form.departments} onToggle={toggleIn('departments')} />
              <PickGroup label="Course" items={courses?.data} value={form.courses} onToggle={toggleIn('courses')} labelKey="courseId" />
              <PickGroup label="Batch" items={batches?.data} value={form.batches} onToggle={toggleIn('batches')} />
              <PickGroup label="Semester" items={semesters?.data} value={form.semesters} onToggle={toggleIn('semesters')} />
            </div>
          ) : (
            <PublicAccessSection value={form.publicAccess} onChange={(next) => setForm({ ...form, publicAccess: next })} editingId={editingId} slug={form.publicAccess.slug} />
          )}

          <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, questionSelection: { ...f.questionSelection, mode: 'fixed' } }))}
              className={`flex-1 h-8 rounded-md text-xs font-medium ${form.questionSelection.mode === 'fixed' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
            >
              Fixed Questions
            </button>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, questionSelection: { ...f.questionSelection, mode: 'random' } }))}
              className={`flex-1 h-8 rounded-md text-xs font-medium ${form.questionSelection.mode === 'random' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
            >
              Random Selection
            </button>
          </div>

          {form.questionSelection.mode === 'fixed' ? (
            <div className="border border-slate-200 rounded-lg p-3 space-y-2">
              <p className="text-xs font-semibold text-slate-500">Questions from the bank</p>
              <div className="grid grid-cols-2 gap-2">
                <select value={bankDept} onChange={(e) => { setBankDept(e.target.value); setBankCourse(''); }} className="input">
                  <option value="">Department</option>
                  {(departmentOptions || []).map((d) => <option key={d._id} value={d._id}>{d.code}</option>)}
                </select>
                <select value={bankCourse} onChange={(e) => setBankCourse(e.target.value)} className="input" disabled={!bankDept}>
                  <option value="">Course</option>
                  {(isFaculty ? (facultyCourses?.data || []).filter((c) => c.department._id === bankDept) : (courses?.data || [])).map((c) => (
                    <option key={c._id} value={c._id}>{c.courseId}</option>
                  ))}
                </select>
              </div>
              <input
                type="text"
                value={bankSearch}
                onChange={(e) => setBankSearch(e.target.value)}
                placeholder="Search bank questions (typo-tolerant)..."
                disabled={!bankDept || !bankCourse}
                className="input w-full text-xs"
              />
              {bankQuestions?.data?.length > 0 && (
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {bankQuestions.data.map((q) => (
                    <button
                      type="button"
                      key={q._id}
                      onClick={() => addQuestion(q)}
                      disabled={selectedQuestions.some((s) => s.question._id === q._id)}
                      className="w-full text-left text-xs p-2 rounded border border-slate-200 hover:bg-brand-50 disabled:opacity-40"
                    >
                      [{q.type}] {q.text.slice(0, 60)}
                    </button>
                  ))}
                </div>
              )}

              {selectedQuestions.length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-slate-100">
                  {selectedQuestions.map((s) => (
                    <div key={s.question._id} className="flex items-center gap-2 text-xs">
                      <span className="flex-1 truncate">{s.question.text}</span>
                      <input type="number" min={0} value={s.marks} onChange={(e) => setQuestionMarks(s.question._id, e.target.value)} className="w-14 h-7 rounded border border-slate-300 px-1" />
                      <button type="button" onClick={() => removeQuestion(s.question._id)} className="text-slate-400 hover:text-red-600"><X size={14} /></button>
                    </div>
                  ))}
                  <p className="text-xs font-medium text-slate-600">Total marks: {totalMarks}</p>
                </div>
              )}
            </div>
          ) : (
            <RandomSelectionBuilder
              rules={form.questionSelection.rules}
              onChange={(rules) => setForm((f) => ({ ...f, questionSelection: { ...f.questionSelection, rules } }))}
              courses={isFaculty ? facultyCourses?.data : courses?.data}
            />
          )}

          <button className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold flex items-center justify-center gap-2">
            <Plus size={16} /> {editingId ? 'Update' : 'Create'} Quiz
          </button>
          {editingId && <button type="button" onClick={resetForm} className="w-full h-9 text-sm text-slate-500">Cancel edit</button>}
        </form>
      </div>

      <div className="lg:col-span-2 space-y-2">
        {isLoading ? (
          <p className="text-slate-400">Loading...</p>
        ) : quizzes.length === 0 ? (
          <p className="text-slate-400">No quizzes yet.</p>
        ) : (
          quizzes.map((q) => {
            const isPublic = q.examType === 'public';
            const publicUrl = isPublic && q.publicAccess?.slug ? `${window.location.origin}/exam/${q.publicAccess.slug}` : null;
            return (
              <div key={q._id} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-700">{q.title}</p>
                      {isPublic && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-sky-50 text-sky-700">
                          <Globe size={11} /> Public
                        </span>
                      )}
                      {isPublic && q.publicAccess?.disabled && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600">
                          <Ban size={11} /> Disabled
                        </span>
                      )}
                    </div>
                    <MathText text={q.description} className="text-sm text-slate-500 mt-0.5" />
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[q.status]}`}>{q.status}</span>
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  {isPublic
                    ? publicUrl || 'No public link yet'
                    : [
                        q.departments?.map((d) => d.code).join(', '),
                        q.courses?.map((c) => c.courseId).join(', '),
                        q.batches?.map((b) => b.name).join(', '),
                        q.semesters?.map((s) => s.name).join(', '),
                      ].filter(Boolean).join(' + ') || 'No target'}
                  {' · '}Total {q.totalMarks} marks &middot; {formatDate(q.startAt)} – {formatDate(q.endAt)}
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button onClick={() => edit(q)} className="p-1.5 rounded hover:bg-slate-100"><Pencil size={16} /></button>
                  <button onClick={() => remove(q._id)} className="p-1.5 rounded hover:bg-red-50 text-red-600"><Trash2 size={16} /></button>
                  <button onClick={() => setViewingAttempts(q)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">
                    <Users size={14} /> Attempts
                  </button>
                  {isPublic && publicUrl && (
                    <>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(publicUrl);
                          toast('Public link copied', 'success');
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 text-sm text-slate-600 hover:bg-slate-50"
                      >
                        <Link2 size={14} /> Copy Public Link
                      </button>
                      <button
                        onClick={async () => {
                          try {
                            await quizApi.update(q._id, { publicAccess: { ...q.publicAccess, disabled: !q.publicAccess.disabled } });
                            toast(q.publicAccess.disabled ? 'Exam re-enabled' : 'Exam disabled', 'success');
                            qc.invalidateQueries({ queryKey: ['my-quizzes'] });
                          } catch (err) {
                            toast(err.response?.data?.message || 'Update failed', 'error');
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 text-sm text-slate-600 hover:bg-slate-50"
                      >
                        <Ban size={14} /> {q.publicAccess.disabled ? 'Enable' : 'Disable'}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {viewingAttempts && <QuizAttemptsPanel quiz={viewingAttempts} onClose={() => setViewingAttempts(null)} />}

      <style>{`.input { width: 100%; height: 2.5rem; border-radius: 0.5rem; border: 1px solid #cbd5e1; padding: 0 0.75rem; font-size: 0.875rem; }
      textarea.input { height: auto; padding: 0.6rem 0.75rem; }
      .input:disabled { background-color: #f1f5f9; color: #94a3b8; }`}</style>
    </div>
  );
}

// Configures publicAccess for a Public Exam — slug/password/participant
// fields/login requirement/attempt limit/result visibility. Course-exam
// targeting (departments/courses/batches/semesters) is untouched and simply
// not rendered while this section is shown instead.
// Faculty builds one or more sampling rules (course + difficulty/tags +
// count + marks each) instead of hand-picking questions — each participant
// gets a fresh random draw from the matching bank at attempt-start, snapshot
// onto their attempt so a refresh never re-shuffles and a later bank edit
// never touches an already-taken attempt (server/src/services/examEngine.js).
function RandomSelectionBuilder({ rules, onChange, courses }) {
  const addRule = () => onChange([...rules, { ...emptyRule }]);
  const updateRule = (i, patch) => onChange(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRule = (i) => onChange(rules.filter((_, idx) => idx !== i));

  const totalQuestions = rules.reduce((sum, r) => sum + (Number(r.count) || 0), 0);
  const totalMarks = rules.reduce((sum, r) => sum + (Number(r.count) || 0) * (Number(r.marksEach) || 0), 0);

  return (
    <div className="border border-slate-200 rounded-lg p-3 space-y-3">
      <p className="text-xs text-slate-500">
        Each participant is randomly assigned questions matching these rules from the bank at attempt-start — different participants can get different
        questions.
      </p>
      {rules.map((rule, i) => (
        <RuleRow key={i} rule={rule} courses={courses} onChange={(patch) => updateRule(i, patch)} onRemove={() => removeRule(i)} />
      ))}
      <button type="button" onClick={addRule} className="text-xs text-brand-600 hover:underline">+ Add Rule</button>
      {rules.length > 0 && (
        <p className="text-xs font-medium text-slate-600 pt-2 border-t border-slate-100">
          Total: {totalQuestions} question(s) &middot; {totalMarks} marks
        </p>
      )}
    </div>
  );
}

function RuleRow({ rule, courses, onChange, onRemove }) {
  const { data: countData } = useQuery({
    queryKey: ['question-pool-count', rule.course, rule.difficulty, rule.tags],
    queryFn: () =>
      questionApi.list({
        course: rule.course,
        difficulty: rule.difficulty !== 'any' ? rule.difficulty : undefined,
        tags: rule.tags || undefined,
        limit: 1,
      }),
    enabled: !!rule.course,
  });
  const available = countData?.pagination?.total;
  const short = available !== undefined && Number(rule.count) > available;

  return (
    <div className="border border-slate-200 rounded-lg p-2.5 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select value={rule.course} onChange={(e) => onChange({ course: e.target.value })} className="input">
          <option value="">Course</option>
          {(courses || []).map((c) => <option key={c._id} value={c._id}>{c.courseId}</option>)}
        </select>
        <select value={rule.difficulty} onChange={(e) => onChange({ difficulty: e.target.value })} className="input">
          <option value="any">Any difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
      </div>
      <input value={rule.tags} onChange={(e) => onChange({ tags: e.target.value })} placeholder="Tags, comma separated (optional)" className="input" />
      <div className="grid grid-cols-3 gap-2 items-center">
        <input type="number" min={1} value={rule.count} onChange={(e) => onChange({ count: e.target.value })} placeholder="Count" className="input" />
        <input type="number" min={0} value={rule.marksEach} onChange={(e) => onChange({ marksEach: e.target.value })} placeholder="Marks each" className="input" />
        <button type="button" onClick={onRemove} className="flex items-center justify-center gap-1 text-xs text-red-500 hover:underline">
          <X size={12} /> Remove
        </button>
      </div>
      {rule.course && (
        <p className={`text-xs ${short ? 'text-red-600' : 'text-slate-400'}`}>
          {available === undefined ? 'Checking availability...' : `${available} question(s) available`}
          {short && ' — not enough for this rule'}
        </p>
      )}
    </div>
  );
}

function PublicAccessSection({ value: pa, onChange, editingId, slug }) {
  const set = (patch) => onChange({ ...pa, ...patch });
  const setField = (key, patch) => onChange({ ...pa, [key]: { ...pa[key], ...patch } });
  const publicUrl = slug ? `${window.location.origin}/exam/${slug}` : null;

  return (
    <div className="space-y-3 border border-slate-200 rounded-lg p-3">
      <p className="text-xs font-semibold text-slate-500">Public Access</p>

      <input value={pa.publicName} onChange={(e) => set({ publicName: e.target.value })} placeholder="Public exam name (defaults to the title above)" className="input" />

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Public URL slug (leave blank to auto-generate)</label>
        <input value={pa.slug} onChange={(e) => set({ slug: e.target.value })} placeholder="e.g. computer-science-admission-2026" className="input" />
        {publicUrl && <p className="text-xs text-brand-600 mt-1 truncate">{publicUrl}</p>}
      </div>

      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={pa.passwordEnabled} onChange={(e) => set({ passwordEnabled: e.target.checked })} /> Password protected</label>
      {pa.passwordEnabled && (
        <input
          type="text"
          value={pa.password}
          onChange={(e) => set({ password: e.target.value })}
          placeholder={editingId ? 'Leave blank to keep the existing password' : 'Set a password'}
          className="input"
        />
      )}

      <div className="grid grid-cols-3 gap-2">
        {['name', 'email', 'phone'].map((key) => (
          <div key={key}>
            <label className="block text-xs font-medium text-slate-500 mb-1 capitalize">{key}</label>
            <select value={pa.participantFields[key]} onChange={(e) => setField('participantFields', { [key]: e.target.value })} className="input">
              <option value="required">Required</option>
              <option value="optional">Optional</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>
        ))}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Login requirement</label>
        <select value={pa.loginRequirement} onChange={(e) => set({ loginRequirement: e.target.value })} className="input">
          <option value="guest">Guest access (no login needed)</option>
          <option value="optional">Optional login</option>
          <option value="required">Login required</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select value={pa.attemptLimit.type} onChange={(e) => setField('attemptLimit', { type: e.target.value })} className="input">
          <option value="unlimited">Unlimited attempts</option>
          <option value="one">One attempt</option>
          <option value="max">Max attempts...</option>
        </select>
        {pa.attemptLimit.type === 'max' && (
          <input type="number" min={1} value={pa.attemptLimit.max} onChange={(e) => setField('attemptLimit', { max: Number(e.target.value) })} className="input" placeholder="Max attempts" />
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-500 mb-1">Result visibility</label>
        <select value={pa.resultSettings.visibility} onChange={(e) => setField('resultSettings', { visibility: e.target.value })} className="input">
          <option value="immediate">Immediately after submission</option>
          <option value="after_grading">After manual grading</option>
          <option value="scheduled">Scheduled</option>
          <option value="hidden">Hidden</option>
        </select>
      </div>
      {pa.resultSettings.visibility === 'scheduled' && (
        <input
          type="datetime-local"
          value={pa.resultSettings.scheduledAt ? String(pa.resultSettings.scheduledAt).slice(0, 16) : ''}
          onChange={(e) => setField('resultSettings', { scheduledAt: e.target.value })}
          className="input"
        />
      )}

      <div className="space-y-1.5 text-sm">
        {[
          ['showScore', 'Show score'],
          ['showPercentage', 'Show percentage'],
          ['showPassFail', 'Show pass/fail'],
          ['showCorrectAnswers', 'Show correct answers'],
          ['showExplanations', 'Show explanations'],
          ['showQuestionByQuestion', 'Show question-by-question result'],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input type="checkbox" checked={pa.resultSettings[key]} onChange={(e) => setField('resultSettings', { [key]: e.target.checked })} /> {label}
          </label>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={pa.disabled} onChange={(e) => set({ disabled: e.target.checked })} /> Disabled (immediately unavailable to participants)
      </label>
    </div>
  );
}

function PickGroup({ label, items, value, onToggle, labelKey = 'name' }) {
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 mb-1.5">{label}</p>
      <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
        {(items || []).map((item) => (
          <button
            type="button"
            key={item._id}
            onClick={() => onToggle(item._id)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
              value.includes(item._id) ? 'bg-brand-600 text-white border-brand-600' : 'border-slate-300 text-slate-600'
            }`}
          >
            {item[labelKey] || item.name}
          </button>
        ))}
        {!items?.length && <span className="text-xs text-slate-400">None available</span>}
      </div>
    </div>
  );
}
