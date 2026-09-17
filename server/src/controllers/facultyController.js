import Course from '../models/Course.js';
import { TEACHING_STATUSES } from '../models/FacultyCourse.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import {
  facultyCourseClause,
  assertFacultyCourseAccess,
  teachingStatusMap,
  setTeachingStatus,
  contentCountsByCourse,
} from '../services/teachingService.js';

// GET /faculty/courses — every course the Faculty member is authorized to
// work with: courses assigned to them directly, plus every course in a
// department assigned to them wholesale.
//
// Each course carries its per-faculty `teachingStatus` (see
// models/FacultyCourse.js). A course with no row yet is `deactivated` — the
// required default — so this is always total. `?status=active|deactivated`
// narrows the list, and `?counts=true` adds file/assignment/quiz counts for the
// My Courses cards (the counts cost extra queries, so they are opt-in).
export const getFacultyCourses = asyncHandler(async (req, res) => {
  const { status } = req.query;
  const withCounts = req.query.counts === 'true' || req.query.counts === '1';

  const courses = await Course.find({ status: 'active', ...facultyCourseClause(req.user) })
    .populate('department', 'name code')
    .sort({ name: 1 });

  const courseIds = courses.map((course) => course._id);
  const [teaching, countsByCourse] = await Promise.all([
    teachingStatusMap(req.user._id, courseIds),
    withCounts ? contentCountsByCourse(courseIds) : Promise.resolve(new Map()),
  ]);

  let data = courses.map((course) => {
    const row = teaching.get(String(course._id));
    return {
      ...course.toObject(),
      teachingStatus: row?.status || 'deactivated',
      lastBatch: row?.lastBatch || null,
      ...(withCounts
        ? {
            counts:
              countsByCourse.get(String(course._id)) ||
              { files: 0, assignments: 0, quizzes: 0 },
          }
        : {}),
    };
  });

  if (status === 'active' || status === 'deactivated') {
    data = data.filter((course) => course.teachingStatus === status);
  }

  res.json({ success: true, data });
});

// PATCH /faculty/courses/:courseId/status { status }
//
// Activating/deactivating is scoped to the calling faculty member only — it
// changes whether the course appears under *their* Active Classes, and never
// hides the course from other faculty members or from students. Nothing is
// deleted either way.
//
// The course must already be one this faculty member is assigned to; the check
// is the same rule as the list above, so a course that is not in My Courses
// cannot be activated through the API (spec §31).
export const setCourseTeachingStatus = asyncHandler(async (req, res) => {
  const { status } = req.body || {};
  if (!TEACHING_STATUSES.includes(status)) {
    throw new ApiError(400, 'status must be one of: ' + TEACHING_STATUSES.join(', '));
  }

  const course = await assertFacultyCourseAccess(req.user, req.params.courseId);
  const row = await setTeachingStatus(req.user._id, course._id, status);

  res.json({
    success: true,
    message: status === 'active' ? 'Course activated' : 'Course deactivated',
    data: { course: course._id, teachingStatus: row.status },
  });
});
