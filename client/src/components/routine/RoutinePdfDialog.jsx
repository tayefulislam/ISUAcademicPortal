import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, X } from 'lucide-react';
import { departmentApi, batchApi, semesterApi, routineApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';

// "Download the class routine" — a Department + Batch + Semester picker that
// produces a printable PDF (a weekly grid: days across the top, class-time slots
// down the side).
//
// Deliberately available to every signed-in role, on the Calendar page as well as
// the Routine Manager: the department's timetable is the institution's own class
// schedule, and the server validates the chosen scope and builds the PDF from it.
// The pickers only ever choose WHICH timetable to print — never what is in it.
export default function RoutinePdfDialog({
  defaultDepartment = '',
  defaultBatch = '',
  defaultSemester = '',
  label = 'Download routine (PDF)',
  className = '',
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [department, setDepartment] = useState('');
  const [batch, setBatch] = useState('');
  const [semester, setSemester] = useState('');
  const [busy, setBusy] = useState(false);

  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: departmentApi.list, enabled: open });
  const { data: batches } = useQuery({ queryKey: ['batches'], queryFn: () => batchApi.list(), enabled: open });
  const { data: semesters } = useQuery({ queryKey: ['semesters'], queryFn: semesterApi.list, enabled: open });

  // Seeded from the caller's scope (the manager's current pick, or the signed-in
  // user's own department/batch/semester) each time it is opened, so the common
  // case is one tap — and a previous edit is not silently carried over.
  const openDialog = () => {
    setDepartment(defaultDepartment || '');
    setBatch(defaultBatch || '');
    setSemester(defaultSemester || '');
    setOpen(true);
  };

  const download = async () => {
    if (!department) {
      toast('Select a department', 'error');
      return;
    }
    setBusy(true);
    try {
      await routineApi.downloadTimetable({
        department,
        batch: batch || undefined,
        semester: semester || undefined,
      });
      toast('Routine downloaded', 'success');
      setOpen(false);
    } catch (err) {
      toast(err.response?.data?.message || 'Could not build the routine PDF', 'error');
    } finally {
      setBusy(false);
    }
  };

  const select = 'w-full h-11 rounded-lg border border-slate-300 px-3 text-sm text-slate-800';

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={
          className ||
          'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50'
        }
      >
        <Download size={15} /> {label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Download class routine</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  A printable weekly timetable (PDF) for the scope you choose.
                </p>
              </div>
              <button onClick={() => setOpen(false)} className="p-1 text-slate-400 hover:text-slate-600" aria-label="Close">
                <X size={18} />
              </button>
            </div>

            <label className="block">
              <span className="block text-sm font-medium text-slate-700 mb-1">
                Department <span className="text-red-500">*</span>
              </span>
              <select value={department} onChange={(e) => setDepartment(e.target.value)} className={select}>
                <option value="">Select department</option>
                {(departments?.data || []).map((d) => (
                  <option key={d._id} value={d._id}>{d.code} — {d.name}</option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-sm font-medium text-slate-700 mb-1">Batch</span>
                <select value={batch} onChange={(e) => setBatch(e.target.value)} className={select}>
                  <option value="">All batches</option>
                  {(batches?.data || []).map((b) => (
                    <option key={b._id} value={b._id}>{b.code || b.name}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="block text-sm font-medium text-slate-700 mb-1">Semester</span>
                <select value={semester} onChange={(e) => setSemester(e.target.value)} className={select}>
                  <option value="">All semesters</option>
                  {(semesters?.data || []).map((s) => (
                    <option key={s._id} value={s._id}>{s.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={download}
                disabled={busy || !department}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-60"
              >
                <Download size={15} /> {busy ? 'Building...' : 'Download PDF'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
