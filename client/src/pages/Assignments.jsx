import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Paperclip, Upload, X } from 'lucide-react';
import { assignmentApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';
import { formatDate } from '../utils/format.js';

const STATUS_STYLE = { draft: 'bg-slate-100 text-slate-600', published: 'bg-emerald-50 text-emerald-700', closed: 'bg-red-50 text-red-600' };
const SUB_STYLE = { submitted: 'bg-brand-50 text-brand-700', late: 'bg-amber-50 text-amber-700', graded: 'bg-emerald-50 text-emerald-700' };

export default function Assignments() {
  const [submittingFor, setSubmittingFor] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ['assignments'], queryFn: assignmentApi.list });
  const assignments = data?.data || [];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center gap-2 mb-1">
        <ClipboardList className="text-brand-600" size={22} />
        <h1 className="text-2xl font-bold text-slate-800">Assignments</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">Assignments targeted to your department, course, batch, and semester.</p>

      {isLoading ? (
        <p className="text-slate-400">Loading...</p>
      ) : assignments.length === 0 ? (
        <p className="text-slate-400">No assignments right now.</p>
      ) : (
        <div className="space-y-3">
          {assignments.map((a) => (
            <div key={a._id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-700">{a.title}</p>
                  <p className="text-sm text-slate-600 mt-0.5">{a.description}</p>
                </div>
                <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[a.status]}`}>{a.status}</span>
              </div>

              {a.attachments?.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {a.attachments.map((att) => (
                    <a key={att._id} href={att.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">
                      <Paperclip size={12} /> {att.originalName}
                    </a>
                  ))}
                </div>
              )}

              <p className="text-xs text-slate-400 mt-2">
                Max {a.maxMarks} marks &middot; Deadline {formatDate(a.deadline)}
              </p>

              <div className="flex items-center justify-between mt-3">
                {a.mySubmission ? (
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${SUB_STYLE[a.mySubmission.status]}`}>{a.mySubmission.status}</span>
                    {a.mySubmission.status === 'graded' && (
                      <span className="text-sm text-slate-600">
                        {a.mySubmission.marks}/{a.maxMarks} {a.mySubmission.feedback && <>&middot; {a.mySubmission.feedback}</>}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-slate-400">Not submitted</span>
                )}

                {a.status === 'published' && (!a.mySubmission || (a.allowResubmission && a.mySubmission.status !== 'graded')) && (
                  <button
                    onClick={() => setSubmittingFor(a)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
                  >
                    <Upload size={14} /> {a.mySubmission ? 'Replace Submission' : 'Submit'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {submittingFor && <SubmitModal assignment={submittingFor} onClose={() => setSubmittingFor(null)} />}
    </div>
  );
}

function SubmitModal({ assignment, onClose }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const needsText = assignment.submissionType !== 'file';
  const needsFile = assignment.submissionType !== 'text';

  const submit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const fd = new FormData();
      if (text) fd.append('text', text);
      files.forEach((f) => fd.append('files', f));
      const res = await assignmentApi.submit(assignment._id, fd);
      toast(res.message || 'Submitted', 'success');
      qc.invalidateQueries({ queryKey: ['assignments'] });
      onClose();
    } catch (err) {
      toast(err.response?.data?.message || 'Submission failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800">Submit — {assignment.title}</h2>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-slate-100"><X size={18} /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {needsText && (
            <textarea
              required
              rows={5}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Write your answer..."
              className="w-full rounded-lg border border-slate-300 p-3 text-sm"
            />
          )}
          {needsFile && (
            <input
              type="file"
              multiple
              required={needsFile && !assignment.mySubmission}
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
              className="w-full text-sm"
            />
          )}
          <button disabled={submitting} className="w-full h-10 rounded-lg bg-brand-600 text-white font-semibold disabled:opacity-60">
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </form>
      </div>
    </div>
  );
}
