import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X } from 'lucide-react';
import { adminApi } from '../../api/endpoints.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatDate } from '../../utils/format.js';

export default function AdminStudentApprovals() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['pending-students'], queryFn: adminApi.pendingStudents });

  const students = data?.data || [];

  const act = async (id, action) => {
    try {
      if (action === 'approve') await adminApi.approveStudent(id);
      else await adminApi.rejectStudent(id);
      toast(`Student ${action === 'approve' ? 'approved' : 'rejected'}`, 'success');
      qc.invalidateQueries({ queryKey: ['pending-students'] });
    } catch (err) {
      toast(err.response?.data?.message || 'Action failed', 'error');
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 mb-4">Pending Student Approvals</h1>
      {isLoading ? (
        <p className="text-slate-400">Loading...</p>
      ) : students.length === 0 ? (
        <p className="text-slate-400">No pending registrations.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {students.map((s) => (
            <StudentCard key={s._id} student={s} onAct={act} />
          ))}
        </div>
      )}
    </div>
  );
}

function StudentCard({ student, onAct }) {
  const [photoUrl, setPhotoUrl] = useState(null);

  useEffect(() => {
    let objectUrl;
    adminApi
      .studentIdPhotoUrl(student._id)
      .then((url) => {
        objectUrl = url;
        setPhotoUrl(url);
      })
      .catch(() => setPhotoUrl(''));
    return () => objectUrl && URL.revokeObjectURL(objectUrl);
  }, [student._id]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="aspect-[4/3] bg-slate-100 rounded-lg overflow-hidden mb-3 flex items-center justify-center">
        {photoUrl === null ? (
          <span className="text-xs text-slate-400">Loading photo...</span>
        ) : photoUrl ? (
          <img src={photoUrl} alt="Student ID" className="w-full h-full object-cover" />
        ) : (
          <span className="text-xs text-slate-400">No photo on file</span>
        )}
      </div>
      <p className="font-semibold text-slate-700">{student.name}</p>
      <p className="text-xs text-slate-500">{student.email}</p>
      <p className="text-xs text-slate-500 mt-1">
        Roll {student.rollNo || '—'} &middot; {student.department?.code || '—'} &middot; {student.batch?.name || '—'} &middot;{' '}
        {student.semester?.name || '—'}
      </p>
      <p className="text-xs text-slate-400 mt-1">Registered {formatDate(student.createdAt)}</p>
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => onAct(student._id, 'approve')}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-green-600 text-white text-sm font-medium hover:bg-green-700"
        >
          <Check size={14} /> Approve
        </button>
        <button
          onClick={() => onAct(student._id, 'reject')}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-red-50 text-red-600 border border-red-200 text-sm font-medium hover:bg-red-100"
        >
          <X size={14} /> Reject
        </button>
      </div>
    </div>
  );
}
