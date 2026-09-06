import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { getPrivateImageStream, deletePrivateImage } from '../services/storage/storageService.js';

const POPULATE = [
  { path: 'department', select: 'name code' },
  { path: 'batch', select: 'name code' },
  { path: 'semester', select: 'name code' },
];

// GET /admin/students/pending — Admin and Super Admin both see the queue.
export const listPendingStudents = asyncHandler(async (req, res) => {
  const students = await User.find({ role: 'student', approvalStatus: 'pending' })
    .populate(POPULATE)
    .sort({ createdAt: 1 });
  res.json({ success: true, data: students.map((s) => s.toSafeObject()) });
});

// GET /admin/students/:id/id-photo — authenticated proxy read of the
// private student-ID image. Never a public/signed URL; the stream is piped
// straight through from storage to this admin's response.
export const getStudentIdPhoto = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('+studentIdImageKey');
  if (!user || !user.studentIdImageKey) throw new ApiError(404, 'No ID photo on file');

  const { stream, contentType } = await getPrivateImageStream(user.studentIdImageKey);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  stream.pipe(res);
});

export const approveStudent = asyncHandler(async (req, res) => {
  const student = await User.findById(req.params.id);
  if (!student || student.role !== 'student') throw new ApiError(404, 'Student not found');

  student.approvalStatus = 'approved';
  student.tokenVersion += 1; // so restricted-material access unlocks on their next request
  await student.save();

  res.json({ success: true, message: 'Student approved', data: student.toSafeObject() });
});

export const rejectStudent = asyncHandler(async (req, res) => {
  const student = await User.findById(req.params.id);
  if (!student || student.role !== 'student') throw new ApiError(404, 'Student not found');

  student.approvalStatus = 'rejected';
  student.tokenVersion += 1;
  await student.save();

  res.json({ success: true, message: 'Student rejected', data: student.toSafeObject() });
});
