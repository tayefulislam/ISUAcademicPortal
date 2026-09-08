import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X, Paperclip } from 'lucide-react';
import { assignmentApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/format.js';

const STATUS_STYLE = { submitted: 'bg-brand-50 text-brand-700', late: 'bg-amber-50 text-amber-700', graded: 'bg-emerald-50 text-emerald-700' };

export default function SubmissionsPanel({ assignment, onClose }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['submissions', assignment._id], queryFn: () => assignmentApi.listSubmissions(assignment._id) });
  const [grades, setGrades] = useState({});

  const submissions = data?.data || [];

  const setGrade = (id, key, val) => setGrades((g) => ({ ...g, [id]: { ...g[id], [key]: val } }));

  const submitGrade = async (submissionId) => {
    const g = grades[submissionId];
    if (!g?.marks) return toast('Enter marks first', 'error');
    try {
      await assignmentApi.grade(assignment._id, submissionId, { marks: Number(g.marks), feedback: g.feedback || '' });
      toast('Graded', 'success');
      qc.invalidateQueries({ queryKey: ['submissions', assignment._id] });
    } catch (err) {
      toast(err.response?.data?.message || 'Grading failed', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-3xl w-full max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Submissions — {assignment.title}</h2>
            <p className="text-xs text-slate-500">Max marks: {assignment.maxMarks}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100"><X size={18} /></button>
        </div>

        {isLoading ? (
          <p className="text-slate-400">Loading...</p>
        ) : submissions.length === 0 ? (
          <p className="text-slate-400">No submissions yet.</p>
        ) : (
          <div className="space-y-3">
            {submissions.map((s) => (
              <div key={s._id} className="border border-slate-200 rounded-lg p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-700">{s.student?.name}</p>
                    <p className="text-xs text-slate-500">
                      {s.student?.email} &middot; Roll {s.student?.rollNo || '-'} &middot; {s.student?.department?.code} &middot; {s.student?.batch?.name}
                    </p>
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[s.status]}`}>{s.status}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">Submitted {formatDate(s.submittedAt)}</p>
                {s.text && <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{s.text}</p>}
                {s.attachments?.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {s.attachments.map((a) => (
                      <a key={a._id} href={a.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">
                        <Paperclip size={12} /> {a.originalName}
                      </a>
                    ))}
                  </div>
                )}

                {s.status === 'graded' ? (
                  <p className="text-sm mt-3 bg-emerald-50 text-emerald-700 rounded-lg px-3 py-2">
                    Marks: {s.marks}/{assignment.maxMarks} {s.feedback && <>&middot; {s.feedback}</>}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2 mt-3">
                    <input
                      type="number"
                      min={0}
                      max={assignment.maxMarks}
                      placeholder={`Marks (max ${assignment.maxMarks})`}
                      value={grades[s._id]?.marks || ''}
                      onChange={(e) => setGrade(s._id, 'marks', e.target.value)}
                      className="h-9 w-40 rounded-lg border border-slate-300 px-2 text-sm"
                    />
                    <input
                      placeholder="Feedback (optional)"
                      value={grades[s._id]?.feedback || ''}
                      onChange={(e) => setGrade(s._id, 'feedback', e.target.value)}
                      className="h-9 flex-1 min-w-[160px] rounded-lg border border-slate-300 px-2 text-sm"
                    />
                    <button onClick={() => submitGrade(s._id)} className="h-9 px-4 rounded-lg bg-brand-600 text-white text-sm font-medium">
                      Save Grade
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
