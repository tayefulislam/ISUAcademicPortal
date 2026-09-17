import mongoose from 'mongoose';
import Course from '../models/Course.js';
import Batch from '../models/Batch.js';
import FacultyCourse from '../models/FacultyCourse.js';
import File from '../models/File.js';
import Assignment from '../models/Assignment.js';
import Quiz from '../models/Quiz.js';
import { ApiError } from '../utils/ApiError.js';

// My Courses is the single place a course is opened, for three roles, so the
// rules it depends on live here rather than being repeated per controller:
// who may teach a course, what "active" means for one faculty member, which
// batches are offerable, and how much content a course holds.

/** How many batches the selector offers (spec: "only the last 8"). */
export const RECENT_BATCH_LIMIT = 8;

/**
 * The courses a Faculty member may work with: those assigned to them directly,
 * plus every course in a department assigned to them wholesale.
 *
 * This is the same rule GET /faculty/courses has always used. It lives here so
 * the list and every write path (status, upload, assignment, quiz) cannot drift
 * apart — previously the write paths only accepted `assignedCourses`, so a
 * faculty member assigned a whole department was offered courses in the UI that
 * the API then refused.
 */
export function facultyCourseClause(user) {
  return {
    $or: [
      { _id: { $in: user?.assignedCourses || [] } },
      { department: { $in: user?.assignedDepartments || [] } },
    ],
  };
}

/**
 * Loads a course the given faculty member is allowed to teach, or throws 403.
 * Used by every faculty-facing write so authorisation is never left to the
 * client (spec §31).
 */
export async function assertFacultyCourseAccess(user, courseId) {
  if (!mongoose.isValidObjectId(courseId)) {
    throw new ApiError(400, 'Invalid course');
  }
  const course = await Course.findOne({
    _id: courseId,
    status: 'active',
    ...facultyCourseClause(user),
  }).populate('department', 'name code');

  if (!course) {
    throw new ApiError(403, 'You do not have access to this course', null, 'FORBIDDEN');
  }
  return course;
}

/**
 * teachingStatus per course for one faculty member. A course with no pivot row
 * is `deactivated` — the required default — so callers can treat this as total.
 */
export async function teachingStatusMap(facultyId, courseIds) {
  if (!courseIds.length) return new Map();
  const rows = await FacultyCourse.find({ faculty: facultyId, course: { $in: courseIds } })
    .select('course status lastBatch');
  return new Map(rows.map((row) => [String(row.course), row]));
}

/**
 * Sets one faculty member's state for one course, creating the row on first use.
 * Deactivating never touches the course or its content.
 */
export async function setTeachingStatus(facultyId, courseId, status) {
  return FacultyCourse.findOneAndUpdate(
    { faculty: facultyId, course: courseId },
    {
      $set: {
        status,
        activatedAt: status === 'active' ? new Date() : null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/** Remembers the batch a faculty member is working in, for Add Content defaults. */
export async function rememberBatch(facultyId, courseId, batchId) {
  if (!batchId) return;
  await FacultyCourse.updateOne(
    { faculty: facultyId, course: courseId },
    { $set: { lastBatch: batchId } }
  );
}

/**
 * The batch ordering number. Batches are named "BATCH-14"/"BATCH 14" in
 * practice, so the trailing number is the real sequence; `year` is a fallback
 * for any naming that has no number, and createdAt breaks the remaining ties.
 */
function batchOrdinal(batch) {
  const code = String(batch.code || '').match(/(\d+)\s*$/);
  if (code) return Number(code[1]);
  const name = String(batch.name || '').match(/(\d+)\s*$/);
  if (name) return Number(name[1]);
  return typeof batch.year === 'number' ? batch.year : 0;
}

/**
 * The most recent batches, newest first — derived from the data every time, so
 * a new batch automatically displaces the oldest (spec §34: never hardcode
 * "Batch 15 … Batch 08").
 */
export async function recentBatches(limit = RECENT_BATCH_LIMIT) {
  const batches = await Batch.find({ status: 'active' }).populate('department', 'name code');
  return batches
    .sort((a, b) => {
      const byNumber = batchOrdinal(b) - batchOrdinal(a);
      if (byNumber !== 0) return byNumber;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    })
    .slice(0, limit);
}

/**
 * Validates that every supplied batch belongs to the course's department.
 * A batch id from another department would otherwise attach content to a group
 * that can never legitimately be enrolled in the course.
 */
export async function assertBatchesForCourse(course, batchIds = []) {
  const ids = [].concat(batchIds || []).filter(Boolean);
  if (!ids.length) return [];

  const batches = await Batch.find({ _id: { $in: ids } }).select('name code department');
  if (batches.length !== new Set(ids.map(String)).size) {
    throw new ApiError(400, 'One or more batches are invalid');
  }

  const courseDepartment = String(course.department?._id || course.department);
  const foreign = batches.find((batch) => batch.department && String(batch.department) !== courseDepartment);
  if (foreign) {
    throw new ApiError(
      400,
      `${foreign.name} does not belong to this course's department`,
      null,
      'BAD_REQUEST'
    );
  }
  return batches;
}

/**
 * A batch only means something for a course in its own department. Applied by
 * every create path that targets a batch, so content can never be aimed at a
 * group that could not legitimately be enrolled in the course.
 */
export async function assertBatchesMatchCourses({ courses = [], batches = [] } = {}) {
  if (!batches.length || !courses.length) return;
  const courseDocs = await Course.find({ _id: { $in: courses } }).select('department name');
  for (const course of courseDocs) {
    await assertBatchesForCourse(course, batches);
  }
}

const toObjectIds = (ids) => ids.map((id) => new mongoose.Types.ObjectId(String(id)));

// Ownership fields differ per collection: a file records `uploadedBy`, while an
// assignment and a quiz record `createdBy`. Both count helpers take an optional
// owner so the numbers on a faculty member's My Courses screen describe THEIR
// content: having access to a course is not the same as owning everything in it.
const fileOwnerClause = (ownerId) => (ownerId ? { uploadedBy: new mongoose.Types.ObjectId(String(ownerId)) } : {});
const authoredOwnerClause = (ownerId) => (ownerId ? { createdBy: new mongoose.Types.ObjectId(String(ownerId)) } : {});

/**
 * How much content each course holds — the counts on a My Courses card.
 * Files count only approved material, matching what a student can actually open.
 *
 * <p>Pass an {@code ownerId} for a faculty member's own view: the card must not
 * advertise material they cannot open, or the count and the list behind it
 * disagree.
 */
export async function contentCountsByCourse(courseIds, ownerId = null) {
  if (!courseIds.length) return new Map();
  const ids = toObjectIds(courseIds);

  const [files, assignments, quizzes] = await Promise.all([
    File.aggregate([
      { $match: { course: { $in: ids }, approvalStatus: 'approved', ...fileOwnerClause(ownerId) } },
      { $group: { _id: '$course', n: { $sum: 1 } } },
    ]),
    Assignment.aggregate([
      { $match: { courses: { $in: ids }, ...authoredOwnerClause(ownerId) } },
      { $unwind: '$courses' },
      { $group: { _id: '$courses', n: { $sum: 1 } } },
    ]),
    Quiz.aggregate([
      { $match: { courses: { $in: ids }, ...authoredOwnerClause(ownerId) } },
      { $unwind: '$courses' },
      { $group: { _id: '$courses', n: { $sum: 1 } } },
    ]),
  ]);

  const counts = new Map();
  const merge = (rows, key) => {
    for (const row of rows) {
      const courseId = String(row._id);
      const entry = counts.get(courseId) || { files: 0, assignments: 0, quizzes: 0 };
      entry[key] = row.n;
      counts.set(courseId, entry);
    }
  };
  merge(files, 'files');
  merge(assignments, 'assignments');
  merge(quizzes, 'quizzes');
  return counts;
}

/**
 * Per-batch content counts for one course, for the batch selector — so a
 * faculty member can see which batch already has material before opening it.
 * Counts explicit batch membership only; a file marked "applies to all batches"
 * belongs to the course rather than to any one batch.
 *
 * <p>Pass an {@code ownerId} when the viewer is a Faculty member, so the chips
 * count the material they will actually be shown rather than the whole
 * department's.
 */
export async function contentCountsByBatch(courseId, batchIds, ownerId = null) {
  const counts = new Map(batchIds.map((id) => [String(id), { files: 0, assignments: 0, quizzes: 0 }]));
  if (!batchIds.length) return counts;

  const course = new mongoose.Types.ObjectId(String(courseId));
  const ids = toObjectIds(batchIds);

  const [files, assignments, quizzes] = await Promise.all([
    File.aggregate([
      { $match: { course, batches: { $in: ids }, ...fileOwnerClause(ownerId) } },
      { $unwind: '$batches' },
      { $match: { batches: { $in: ids } } },
      { $group: { _id: '$batches', n: { $sum: 1 } } },
    ]),
    Assignment.aggregate([
      { $match: { courses: course, batches: { $in: ids }, ...authoredOwnerClause(ownerId) } },
      { $unwind: '$batches' },
      { $match: { batches: { $in: ids } } },
      { $group: { _id: '$batches', n: { $sum: 1 } } },
    ]),
    Quiz.aggregate([
      { $match: { courses: course, batches: { $in: ids }, ...authoredOwnerClause(ownerId) } },
      { $unwind: '$batches' },
      { $match: { batches: { $in: ids } } },
      { $group: { _id: '$batches', n: { $sum: 1 } } },
    ]),
  ]);

  const merge = (rows, key) => {
    for (const row of rows) {
      const entry = counts.get(String(row._id));
      if (entry) entry[key] = row.n;
    }
  };
  merge(files, 'files');
  merge(assignments, 'assignments');
  merge(quizzes, 'quizzes');
  return counts;
}

export default {
  RECENT_BATCH_LIMIT,
  facultyCourseClause,
  assertFacultyCourseAccess,
  teachingStatusMap,
  setTeachingStatus,
  rememberBatch,
  recentBatches,
  assertBatchesForCourse,
  contentCountsByCourse,
  contentCountsByBatch,
};
