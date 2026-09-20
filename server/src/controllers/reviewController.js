import File from '../models/File.js';
import Chapter from '../models/Chapter.js';
import Topic from '../models/Topic.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { isReviewerForFile } from '../services/fileQueryBuilder.js';
import { deleteAllAttachments } from './fileController.js';

// 'admin' and Super Admin see/manage every pending submission. Faculty AND
// any other admin-tier role (e.g. "CR") are scoped to their assigned
// Department(s)/Course(s) — the same fields Faculty already uses — so a CR
// only reviews submissions in their own matching department/course, while
// Admin keeps full unrestricted access.
function isUnrestrictedReviewer(user) {
  return user.role === 'admin' || user.role === 'super_admin' || user.role === 'administrator';
}

function scopeFilter(user) {
  if (isUnrestrictedReviewer(user)) return { approvalStatus: 'pending' };
  return {
    approvalStatus: 'pending',
    $or: [
      { department: { $in: user.assignedDepartments || [] } },
      { course: { $in: user.assignedCourses || [] } },
    ],
  };
}

// The same reviewer rule the whole app uses (fileQueryBuilder.isReviewerForFile):
// the unrestricted reviewer roles see everything, Faculty their assigned
// Department/Course, and a custom admin-tier role (e.g. "CR") only when it holds
// the `reviews` permission and the submission is in its own assigned scope.
async function assertReviewAccess(file, user) {
  if (await isReviewerForFile(user, file)) return;
  throw new ApiError(403, 'This submission is outside your assigned Department/Course', null, 'FORBIDDEN');
}

export const listPendingReviews = asyncHandler(async (req, res) => {
  const files = await File.find(scopeFilter(req.user))
    .populate('department', 'name code')
    .populate('course', 'name courseId')
    .populate('uploadedBy', 'name email rollNo')
    .sort({ createdAt: 1 });
  res.json({ success: true, data: files });
});

export const getPendingFile = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id)
    .populate('department', 'name code')
    .populate('course', 'name courseId')
    .populate('uploadedBy', 'name email rollNo');
  if (!file) throw new ApiError(404, 'Submission not found');
  await assertReviewAccess(file, req.user);
  res.json({ success: true, data: file });
});

// PATCH /reviews/:id/approve — flips pending -> approved. Optionally accepts
// the same visibility/restrictions/chapterId/topicId overrides updateFile
// does, so a reviewer can set final access rules in the same action.
export const approveSubmission = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id);
  if (!file) throw new ApiError(404, 'Submission not found');
  await assertReviewAccess(file, req.user);
  if (file.approvalStatus !== 'pending') throw new ApiError(409, 'This file is not pending review');

  if (req.body.visibility) {
    if (!['public', 'login_required'].includes(req.body.visibility)) {
      throw new ApiError(400, 'visibility must be "public" or "login_required"');
    }
    file.visibility = req.body.visibility;
  }
  if (req.body.restrictions && typeof req.body.restrictions === 'object') {
    const r = req.body.restrictions;
    file.restrictions = {
      departments: Array.isArray(r.departments) ? r.departments : file.restrictions?.departments || [],
      batches: Array.isArray(r.batches) ? r.batches : file.restrictions?.batches || [],
      semesters: Array.isArray(r.semesters) ? r.semesters : file.restrictions?.semesters || [],
      courses: Array.isArray(r.courses) ? r.courses : file.restrictions?.courses || [],
    };
  }
  if (req.body.chapterId !== undefined) {
    const chapter = req.body.chapterId ? await Chapter.findById(req.body.chapterId) : null;
    if (req.body.chapterId && !chapter) throw new ApiError(400, 'Invalid chapter');
    file.chapter = chapter?._id || null;
    file.chapterName = chapter?.name || '';
  }
  if (req.body.topicId !== undefined) {
    const topic = req.body.topicId ? await Topic.findById(req.body.topicId) : null;
    if (req.body.topicId && !topic) throw new ApiError(400, 'Invalid topic');
    file.topic = topic?._id || null;
    file.topicName = topic?.name || '';
  }

  file.approvalStatus = 'approved';
  await file.save();

  res.json({ success: true, message: 'Submission approved and published', data: file });
});

// DELETE /reviews/:id — reject = permanent deletion (storage + document),
// per spec: pending -> rejected -> permanently delete. No 'rejected' state
// is ever persisted.
export const rejectSubmission = asyncHandler(async (req, res) => {
  const file = await File.findById(req.params.id);
  if (!file) throw new ApiError(404, 'Submission not found');
  await assertReviewAccess(file, req.user);
  if (file.approvalStatus !== 'pending') throw new ApiError(409, 'This file is not pending review');

  await deleteAllAttachments(file);
  await file.deleteOne();

  res.json({ success: true, message: 'Submission rejected and deleted' });
});
