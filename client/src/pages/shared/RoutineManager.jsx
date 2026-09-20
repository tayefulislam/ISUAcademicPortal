import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Plus, Trash2, CalendarX, Clock, X, Pencil, RotateCcw } from 'lucide-react';
import SearchableSelect from '../../components/SearchableSelect.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  departmentApi, batchApi, semesterApi, courseApi, routineApi, calendarApi, facultyApi,
} from '../../api/endpoints.js';
import { CLASS_TYPE_LABELS, MODE_LABELS, typeLabel, eventTitle, dhakaDate, clock } from '../../components/routine/eventMeta.js';

// The Routine Manager (spec §43): pick a scope, see that scope's timetable for
// one date, and manage it — add a recurring class, cancel or move a single
// occurrence, or schedule an exam.
//
// Scope is explicit here (unlike every student-facing screen) because a manager
// is deliberately working on behalf of other people's batches. It is still the
// server that decides what they may touch: the listing is filtered to their
// assigned courses and every write re-checks the same scope.

const CLASS_TYPES = ['REGULAR', 'LAB', 'CT', 'MID_TERM', 'FINAL', 'QUIZ', 'PRESENTATION', 'ASSIGNMENT_DEADLINE', 'OTHER'];
const WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];
const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const weekdayNames = (days) => (days || []).map((day) => WEEKDAY_NAMES[day]).join(', ');

// The inherited fields an occurrence can carry a change for, named the way the
// manager talks about them.
const OVERRIDE_LABELS = {
  roomNumber: 'Room',
  startTime: 'Start time',
  endTime: 'End time',
  faculty: 'Faculty',
  group: 'Group',
  classType: 'Class type',
  deliveryMode: 'Mode',
  onlineLink: 'Online link',
};
const overrideLabel = (field) => OVERRIDE_LABELS[field] || field;

/**
 * The one way a course is written on this screen: "Course Name (CSE-203)",
 * matching every other picker and list in the app (Submit Material, Upload,
 * My Courses). Falls back to whichever half exists so a course without a code
 * still reads as something.
 */
function formatCourse(course, fallback = '') {
  if (!course) return fallback;
  if (course.name && course.courseId) return `${course.name} (${course.courseId})`;
  return course.name || course.courseId || fallback;
}

const input = 'w-full h-11 sm:h-10 rounded-lg border border-slate-300 px-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-brand-500';

export default function RoutineManager() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user, isSuperAdminTier } = useAuth();

  // Admin-tier and super-admin manage institution-wide; everyone else (Faculty,
  // and a custom admin-tier role such as "CR") is held to their own assigned
  // scope. The server already enforces this on every read and write — this is
  // the matching UI so the pickers never offer a department/course the request
  // would then refuse.
  const broadScope = isSuperAdminTier || user?.role === 'admin';

  const today = dhakaDate();
  const [date, setDate] = useState(today);
  const [scope, setScope] = useState({ department: '', batch: '', semester: '', group: '' });
  const [showAdd, setShowAdd] = useState(false);
  const [showExam, setShowExam] = useState(false);
  const [rescheduling, setRescheduling] = useState(null);
  const [editingRoutine, setEditingRoutine] = useState(null);

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list, enabled: broadScope });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list() });
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list });
  const { data: courses } = useQuery({
    queryKey: ['courses', scope.department],
    // The course picker filters this list client-side, so a course beyond the
    // server's page would be unfindable no matter what is typed into it.
    queryFn: () => courseApi.list(scope.department
      ? { department: scope.department, limit: 500 }
      : { limit: 500 }),
    enabled: broadScope,
  });
  // A scoped manager's own courses/departments — the same set GET /faculty/courses
  // returns, reused as the source for both pickers.
  const { data: myFacultyCourses } = useQuery({
    queryKey: ['faculty-courses'],
    queryFn: facultyApi.courses,
    enabled: !broadScope,
  });
  const { data: groupsData } = useQuery({ queryKey: ['routine', 'groups'], queryFn: routineApi.groups });

  const myDepartments = useMemo(() => {
    const byId = new Map();
    for (const c of myFacultyCourses?.data || []) {
      if (c.department?._id) byId.set(c.department._id, c.department);
    }
    return [...byId.values()];
  }, [myFacultyCourses]);

  const departmentOptions = broadScope
    ? (departments?.data || []).map((d) => ({ value: d._id, label: `${d.code} — ${d.name}` }))
    : myDepartments.map((d) => ({ value: d._id, label: `${d.code} — ${d.name}` }));
  // Batches carry their own department, so they are filtered here rather than
  // asking the server for another endpoint.
  const batchOptions = (batches?.data || [])
    .filter((b) => !scope.department || !b.department || String(b.department?._id || b.department) === String(scope.department))
    .map((b) => ({ value: b._id, label: b.code || b.name }));
  const semesterOptions = (semesters?.data || []).map((s) => ({ value: s._id, label: s.name }));
  const courseOptions = (broadScope ? courses?.data || [] : myFacultyCourses?.data || [])
    .filter((c) => !scope.department || String(c.department?._id || c.department) === String(scope.department))
    .map((c) => ({ value: c._id, label: formatCourse(c) }));
  const groupOptions = (groupsData?.data?.groups || ['BOTH']).map((g) => ({ value: g, label: g === 'BOTH' ? 'Both (whole batch)' : g }));

  const { data: instancesData, isLoading } = useQuery({
    queryKey: ['routine', 'instances', date, scope.batch, scope.semester, scope.group],
    queryFn: () => routineApi.instances({
      date,
      ...(scope.batch ? { batch: scope.batch } : {}),
      ...(scope.semester ? { semester: scope.semester } : {}),
      ...(scope.group ? { group: scope.group } : {}),
    }),
    enabled: Boolean(scope.batch || scope.semester),
  });

  const instances = instancesData?.data || [];

  // The repeating rules behind those occurrences. Editing one of these is the
  // single change that updates every future date it generated.
  const { data: templatesData } = useQuery({
    queryKey: ['routine', 'templates', scope.batch, scope.semester],
    queryFn: () => routineApi.templates({
      ...(scope.batch ? { batch: scope.batch } : {}),
      ...(scope.semester ? { semester: scope.semester } : {}),
    }),
    enabled: Boolean(scope.batch || scope.semester),
  });
  const templates = templatesData?.data || [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['routine'] });
  };

  const onError = (err) => toast(err?.response?.data?.message || 'That did not work', 'error');

  const cancel = useMutation({
    mutationFn: (id) => routineApi.cancelInstance(id),
    onSuccess: () => { toast('Class cancelled — students have been notified', 'success'); refresh(); },
    onError,
  });

  const remove = useMutation({
    mutationFn: (id) => routineApi.removeInstance(id),
    onSuccess: () => { toast('Entry deleted', 'success'); refresh(); },
    onError,
  });

  // Hands a date back to the routine: the field stops being this date's own and
  // the routine's current value is applied immediately.
  const resetToRoutine = useMutation({
    mutationFn: (row) => routineApi.updateInstance(row._id, { resetFields: row.overriddenFields || [] }),
    onSuccess: () => { toast('Reset to the routine', 'success'); refresh(); },
    onError,
  });

  const scopeReady = Boolean(scope.department && scope.batch && scope.semester);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Routine Manager</h1>
          <p className="text-sm text-slate-500 mt-0.5">Build a class timetable and schedule exams for a batch.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setShowAdd((s) => !s); setShowExam(false); }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
          >
            <Plus size={15} /> Add class
          </button>
          <button
            onClick={() => { setShowExam((s) => !s); setShowAdd(false); }}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <CalendarPlus size={15} /> Add exam
          </button>
        </div>
      </div>

      {/* Scope */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <Field label="Department">
          <SearchableSelect
            value={scope.department}
            onChange={(v) => setScope((s) => ({ ...s, department: v, course: '' }))}
            options={departmentOptions}
            placeholder="Select department"
          />
        </Field>
        <Field label="Batch">
          <SearchableSelect
            value={scope.batch}
            onChange={(v) => setScope((s) => ({ ...s, batch: v }))}
            options={batchOptions}
            placeholder="Select batch"
          />
        </Field>
        <Field label="Semester">
          <SearchableSelect
            value={scope.semester}
            onChange={(v) => setScope((s) => ({ ...s, semester: v }))}
            options={semesterOptions}
            placeholder="Select semester"
          />
        </Field>
        <Field label="Group">
          <SearchableSelect
            value={scope.group}
            onChange={(v) => setScope((s) => ({ ...s, group: v }))}
            options={[{ value: '', label: 'Any group' }, ...groupOptions]}
            placeholder="Any group"
          />
        </Field>
        <Field label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
        </Field>
      </div>

      {/* The recurring rules generating the dates in the timetable. One edit here
          reaches every future class, which is why it is kept separate from the
          per-date actions below. */}
      {scopeReady && templates.length > 0 && (
        <div className="mb-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Recurring routines</h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
            {templates.map((routine) => (
              <div key={routine._id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800">{formatCourse(routine.course, 'Course')}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {weekdayNames(routine.days)} · {clock(routine.startTime)} – {clock(routine.endTime)}
                    {' · '}{routine.roomNumber || 'No room'}
                    {' · '}{routine.startDate} → {routine.endDate}
                    {routine.faculty?.name ? ` · ${routine.faculty.name}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => setEditingRoutine(routine)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Pencil size={15} /> Edit routine
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAdd && (
        <AddClassForm
          scope={scope}
          date={date}
          courseOptions={courseOptions}
          groupOptions={groupOptions}
          groupOptionsLoading={!groupsData}
          onDone={() => { setShowAdd(false); refresh(); }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {showExam && (
        <AddExamForm
          scope={scope}
          date={date}
          courseOptions={courseOptions}
          groupOptions={groupOptions}
          onDone={() => { setShowExam(false); refresh(); }}
          onCancel={() => setShowExam(false)}
        />
      )}

      {/* Timetable */}
      {!scopeReady ? (
        <EmptyState title="Pick a scope" description="Choose a department, batch and semester to see that timetable." />
      ) : isLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}</div>
      ) : instances.length === 0 ? (
        <EmptyState title="Nothing scheduled" description="No classes for this batch on this date. Use Add class to create the timetable." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Time</th>
                <th className="px-4 py-3 font-semibold">Course</th>
                <th className="px-4 py-3 font-semibold hidden sm:table-cell">Faculty</th>
                <th className="px-4 py-3 font-semibold hidden sm:table-cell">Room</th>
                <th className="px-4 py-3 font-semibold">Group</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {instances.map((row) => {
                const cancelled = row.status === 'CANCELLED';
                return (
                  <tr key={row._id} className={cancelled ? 'opacity-60' : ''}>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                      <span>{clock(row.startTime)} – {clock(row.endTime)}</span>
                      {/* A date that was changed for itself, rather than
                          cancelled, is still a class — the badge is what says it
                          will survive the next routine edit. */}
                      {row.overriddenFields?.length > 0 && (
                        <span
                          className="ml-2 inline-flex items-center rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 align-middle"
                          title={`Changed for this date: ${row.overriddenFields.map(overrideLabel).join(', ')}`}
                        >
                          Changed
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{formatCourse(row.course, '—')}</p>
                      <p className="text-xs text-slate-400">{typeLabel({ classType: row.classType })} · {MODE_LABELS[row.deliveryMode]}</p>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell text-slate-600">{row.faculty?.name || '—'}</td>
                    <td className="px-4 py-3 hidden sm:table-cell text-slate-600">{row.roomNumber || (row.deliveryMode === 'ONLINE' ? 'Online' : '—')}</td>
                    <td className="px-4 py-3 text-slate-600">{row.group}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {cancelled ? (
                          <span className="text-xs font-medium text-red-600 px-2 py-1 rounded bg-red-50">Cancelled</span>
                        ) : (
                          <>
                            <button
                              onClick={() => setRescheduling(row)}
                              className="p-1.5 rounded text-slate-400 hover:text-brand-700 hover:bg-brand-50"
                              title="Reschedule this date"
                            >
                              <Clock size={15} />
                            </button>
                            <button
                              onClick={() => cancel.mutate(row._id)}
                              className="p-1.5 rounded text-slate-400 hover:text-amber-700 hover:bg-amber-50"
                              title="Cancel this date"
                            >
                              <CalendarX size={15} />
                            </button>
                          </>
                        )}
                        {row.overriddenFields?.length > 0 && (
                          <button
                            onClick={() => resetToRoutine.mutate(row)}
                            className="p-1.5 rounded text-slate-400 hover:text-brand-700 hover:bg-brand-50"
                            title={`Reset this date to the routine (${row.overriddenFields.map(overrideLabel).join(', ')})`}
                          >
                            <RotateCcw size={15} />
                          </button>
                        )}
                        <button
                          onClick={() => remove.mutate(row._id)}
                          className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                          title="Delete this date"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rescheduling && (
        <RescheduleDialog
          instance={rescheduling}
          onClose={() => setRescheduling(null)}
          onDone={() => { setRescheduling(null); refresh(); }}
        />
      )}

      {editingRoutine && (
        <EditRoutineDialog
          template={editingRoutine}
          groupOptions={groupOptions}
          onClose={() => setEditingRoutine(null)}
          onDone={() => { setEditingRoutine(null); refresh(); }}
        />
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">{label}</span>
      {children}
    </label>
  );
}

/**
 * Creating a class is creating a recurring rule — the server materialises the
 * dates from it, so the form asks for a weekday + date range rather than one
 * date at a time.
 */
function AddClassForm({ scope, date, courseOptions, groupOptions, onDone, onCancel }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    course: '', faculty: '', group: 'BOTH', classType: 'REGULAR', deliveryMode: 'OFFLINE', onlineLink: '',
    roomNumber: '', startTime: '10:00', endTime: '11:30',
    startDate: date, endDate: date, days: [],
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const create = useMutation({
    mutationFn: () => routineApi.create({
      department: scope.department,
      batch: scope.batch,
      semester: scope.semester,
      course: form.course,
      group: form.group,
      faculty: form.faculty || undefined,
      roomNumber: form.roomNumber,
      days: form.days,
      startDate: form.startDate,
      endDate: form.endDate,
      startTime: form.startTime,
      endTime: form.endTime,
      classType: form.classType,
      deliveryMode: form.deliveryMode,
      onlineLink: form.onlineLink,
    }),
    onSuccess: (res) => {
      toast(res.message || 'Routine created', 'success');
      qc.invalidateQueries({ queryKey: ['routine'] });
      onDone();
    },
    onError: (err) => {
      const data = err?.response?.data;
      // A conflict is a 409 with the clashing entry in `details` — surfacing the
      // server's own message is more useful than a generic failure.
      toast(data?.message || 'Could not create the routine', 'error');
    },
  });

  const ready = form.course && form.days.length > 0 && form.startDate && form.endDate && form.startTime && form.endTime
    && (form.deliveryMode === 'OFFLINE' || form.onlineLink);

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); create.mutate(); }}
      className="bg-white border border-brand-200 rounded-xl p-4 mb-5"
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-800">Add a recurring class</h2>
        <button type="button" onClick={onCancel} className="p-1 rounded text-slate-400 hover:text-slate-600"><X size={16} /></button>
      </div>

      <RoutineFields form={form} set={set} courseOptions={courseOptions} groupOptions={groupOptions} />

      <p className="text-xs text-slate-400 mt-2">
        The server generates one entry per matching date in the range. Editing the routine later
        updates every future date that has no individual change.
      </p>

      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
        <button type="submit" disabled={!ready || create.isPending} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
          {create.isPending ? 'Creating…' : 'Create routine'}
        </button>
      </div>
    </form>
  );
}

/**
 * The fields a recurring rule is made of, shared by the create form and the edit
 * dialog so the two can never drift apart.
 *
 * Passing `courseLabel` renders the course read-only: a rule stays on the course
 * it was created for, and everything else about it is editable.
 */
function RoutineFields({ form, set, courseOptions, groupOptions, courseLabel = null }) {
  // The faculty member is inferred from the course (spec §42) — preselected when
  // exactly one teaches it, and only changed deliberately.
  const { data: facultyData } = useQuery({
    queryKey: ['routine', 'faculty', form.course],
    queryFn: () => routineApi.facultyForCourse(form.course),
    enabled: Boolean(form.course),
  });
  const facultyOptions = (facultyData?.data || []).map((f) => ({ value: f._id, label: f.name }));

  const toggleDay = (day) => set({
    days: form.days.includes(day) ? form.days.filter((value) => value !== day) : [...form.days, day].sort(),
  });

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Field label="Course">
          {courseLabel === null ? (
            <SearchableSelect
              value={form.course}
              onChange={(value) => set({ course: value, faculty: '' })}
              options={courseOptions}
              placeholder="Select course"
            />
          ) : (
            <p className="w-full h-11 sm:h-10 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600 flex items-center">
              {courseLabel}
            </p>
          )}
        </Field>
        <Field label="Faculty">
          <SearchableSelect
            value={form.faculty}
            onChange={(value) => set({ faculty: value })}
            options={[{ value: '', label: 'Not assigned' }, ...facultyOptions]}
            placeholder={form.course ? 'Who teaches it' : 'Pick a course first'}
            disabled={!form.course}
          />
        </Field>
        <Field label="Group">
          <SearchableSelect value={form.group} onChange={(value) => set({ group: value })} options={groupOptions} />
        </Field>
        <Field label="Class type">
          <select value={form.classType} onChange={(e) => set({ classType: e.target.value })} className={input}>
            {CLASS_TYPES.map((t) => <option key={t} value={t}>{CLASS_TYPE_LABELS[t]}</option>)}
          </select>
        </Field>
        <Field label="Mode">
          <select value={form.deliveryMode} onChange={(e) => set({ deliveryMode: e.target.value })} className={input}>
            {Object.entries(MODE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label="Room">
          <input value={form.roomNumber} onChange={(e) => set({ roomNumber: e.target.value })} placeholder="501" className={input} />
        </Field>
        <Field label="Start time">
          <input type="time" value={form.startTime} onChange={(e) => set({ startTime: e.target.value })} className={input} required />
        </Field>
        <Field label="End time">
          <input type="time" value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} className={input} required />
        </Field>
        <Field label="From date">
          <input type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} className={input} required />
        </Field>
        <Field label="To date">
          <input type="date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} className={input} required />
        </Field>
        {form.deliveryMode !== 'OFFLINE' && (
          <Field label="Online link">
            <input value={form.onlineLink} onChange={(e) => set({ onlineLink: e.target.value })} placeholder="https://meet..." className={input} required />
          </Field>
        )}
      </div>

      <div className="mt-3">
        <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Repeats on</span>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((day) => (
            <button
              key={day.value}
              type="button"
              onClick={() => toggleDay(day.value)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border ${
                form.days.includes(day.value)
                  ? 'bg-brand-600 border-brand-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-brand-300'
              }`}
              aria-pressed={form.days.includes(day.value)}
            >
              {day.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Editing the rule behind a series — the one control that reaches beyond a single
 * date, so it says so in plain words and asks how far back the change should go.
 */
function EditRoutineDialog({ template, groupOptions, onClose, onDone }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [form, setForm] = useState({
    course: template.course?._id || template.course || '',
    faculty: template.faculty?._id || template.faculty || '',
    group: template.group || 'BOTH',
    classType: template.classType || 'REGULAR',
    deliveryMode: template.deliveryMode || 'OFFLINE',
    onlineLink: template.onlineLink || '',
    roomNumber: template.roomNumber || '',
    startTime: template.startTime,
    endTime: template.endTime,
    startDate: template.startDate,
    endDate: template.endDate,
    days: [...(template.days || [])],
  });
  const [applyFrom, setApplyFrom] = useState('all');
  const [applyFromDate, setApplyFromDate] = useState(template.startDate);
  const [notifyStudents, setNotifyStudents] = useState(false);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const courseLabel = formatCourse(template.course);

  const save = useMutation({
    mutationFn: () => routineApi.updateTemplate(template._id, {
      faculty: form.faculty || null,
      group: form.group,
      classType: form.classType,
      deliveryMode: form.deliveryMode,
      onlineLink: form.onlineLink,
      roomNumber: form.roomNumber,
      startTime: form.startTime,
      endTime: form.endTime,
      startDate: form.startDate,
      endDate: form.endDate,
      days: form.days,
      applyFrom,
      ...(applyFrom === 'date' ? { applyFromDate } : {}),
      notifyStudents,
    }),
    onSuccess: (res) => {
      toast(res.message || 'Routine updated', 'success');
      qc.invalidateQueries({ queryKey: ['routine'] });
      onDone();
    },
    onError: (err) => toast(err?.response?.data?.message || 'Could not update the routine', 'error'),
  });

  const ready = form.days.length > 0 && form.startDate && form.endDate && form.startTime && form.endTime
    && (form.deliveryMode === 'OFFLINE' || form.onlineLink);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-start sm:place-items-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <form
        onSubmit={(e) => { e.preventDefault(); save.mutate(); }}
        className="w-full max-w-3xl bg-white rounded-xl p-5 my-8"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="font-semibold text-slate-800">Update Routine</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Changing this routine will update future classes that don&apos;t have individual schedule changes.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded text-slate-400 hover:text-slate-600"><X size={16} /></button>
        </div>

        <RoutineFields
          form={form}
          set={set}
          courseOptions={[]}
          groupOptions={groupOptions}
          courseLabel={courseLabel || 'Course'}
        />

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Apply change from">
            <select value={applyFrom} onChange={(e) => setApplyFrom(e.target.value)} className={input}>
              <option value="all">All future classes</option>
              <option value="today">Today</option>
              <option value="date">Selected date</option>
              <option value="next">Next occurrence</option>
              <option value="entire">Entire routine (including past)</option>
            </select>
          </Field>
          {applyFrom === 'date' && (
            <Field label="Start from date">
              <input type="date" value={applyFromDate} onChange={(e) => setApplyFromDate(e.target.value)} className={input} required />
            </Field>
          )}
        </div>

        <label className="flex items-center gap-2 mt-3 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={notifyStudents}
            onChange={(e) => setNotifyStudents(e.target.checked)}
            className="rounded border-slate-300"
          />
          Notify students about the classes that actually change
        </label>

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={!ready || save.isPending} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
            {save.isPending ? 'Applying…' : 'Apply to Future Classes'}
          </button>
        </div>
      </form>
    </div>
  );
}

function AddExamForm({ scope, date, courseOptions, groupOptions, onDone, onCancel }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    title: '', course: '', group: 'BOTH', classType: 'CT',
    startDate: date, startTime: '10:00', endTime: '11:00', roomNumber: '', instructions: '',
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const create = useMutation({
    mutationFn: () => calendarApi.createEvent({
      department: scope.department,
      batch: scope.batch,
      semester: scope.semester,
      course: form.course || undefined,
      group: form.group,
      title: form.title,
      classType: form.classType,
      roomNumber: form.roomNumber,
      instructions: form.instructions,
      date: form.startDate,
      startTime: form.startTime,
      endTime: form.endTime,
    }),
    onSuccess: () => {
      toast('Exam scheduled — matching students have been notified', 'success');
      qc.invalidateQueries({ queryKey: ['routine'] });
      onDone();
    },
    onError: (err) => toast(err?.response?.data?.message || 'Could not schedule the exam', 'error'),
  });

  const examTypes = ['CT', 'MID_TERM', 'FINAL', 'QUIZ', 'PRESENTATION'];
  const ready = form.title && form.startDate && form.startTime && form.endTime;

  return (
    <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="bg-white border border-brand-200 rounded-xl p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-800">Schedule an exam or event</h2>
        <button type="button" onClick={onCancel} className="p-1 rounded text-slate-400 hover:text-slate-600"><X size={16} /></button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Field label="Title">
          <input value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="CSE 101 CT-1" className={input} required />
        </Field>
        <Field label="Type">
          <select value={form.classType} onChange={(e) => set({ classType: e.target.value })} className={input}>
            {examTypes.map((t) => <option key={t} value={t}>{CLASS_TYPE_LABELS[t]}</option>)}
          </select>
        </Field>
        <Field label="Course">
          <SearchableSelect
            value={form.course}
            onChange={(v) => set({ course: v })}
            options={[{ value: '', label: 'No course (general event)' }, ...courseOptions]}
            placeholder="Select course"
          />
        </Field>
        <Field label="Group">
          <SearchableSelect value={form.group} onChange={(v) => set({ group: v })} options={groupOptions} />
        </Field>
        <Field label="Date">
          <input type="date" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} className={input} required />
        </Field>
        <Field label="Room">
          <input value={form.roomNumber} onChange={(e) => set({ roomNumber: e.target.value })} placeholder="501" className={input} />
        </Field>
        <Field label="Start time">
          <input type="time" value={form.startTime} onChange={(e) => set({ startTime: e.target.value })} className={input} required />
        </Field>
        <Field label="End time">
          <input type="time" value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} className={input} required />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Instructions">
          <textarea value={form.instructions} onChange={(e) => set({ instructions: e.target.value })} rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </Field>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
        <button type="submit" disabled={!ready || create.isPending} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
          {create.isPending ? 'Scheduling…' : 'Schedule'}
        </button>
      </div>
    </form>
  );
}

/** Moves one date. The recurrence and every other date are untouched. */
function RescheduleDialog({ instance, onClose, onDone }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    date: instance.date,
    startTime: instance.startTime,
    endTime: instance.endTime,
    roomNumber: instance.roomNumber || '',
  });
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const move = useMutation({
    mutationFn: () => routineApi.rescheduleInstance(instance._id, form),
    onSuccess: () => {
      toast('Moved — students have been notified', 'success');
      qc.invalidateQueries({ queryKey: ['routine'] });
      onDone();
    },
    onError: (err) => toast(err?.response?.data?.message || 'Could not reschedule', 'error'),
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 grid place-items-center p-4" role="dialog" aria-modal="true">
      <form
        onSubmit={(e) => { e.preventDefault(); move.mutate(); }}
        className="w-full max-w-md bg-white rounded-xl p-5"
      >
        <h2 className="font-semibold text-slate-800 mb-1">Edit {instance.date} class</h2>
        <p className="text-sm text-slate-500 mb-4">
          {eventTitle({ course: instance.course, title: instance.course?.name })} · changes will apply only to this specific class.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Field label="New date"><input type="date" value={form.date} onChange={(e) => set({ date: e.target.value })} className={input} required /></Field>
          <Field label="Room"><input value={form.roomNumber} onChange={(e) => set({ roomNumber: e.target.value })} className={input} /></Field>
          <Field label="Start"><input type="time" value={form.startTime} onChange={(e) => set({ startTime: e.target.value })} className={input} required /></Field>
          <Field label="End"><input type="time" value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} className={input} required /></Field>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={move.isPending} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-50">
            {move.isPending ? 'Saving…' : 'Save This Class'}
          </button>
        </div>
      </form>
    </div>
  );
}
