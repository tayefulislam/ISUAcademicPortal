import mongoose from 'mongoose';
import Course from '../models/Course.js';
import CourseEnrollment from '../models/CourseEnrollment.js';
import File from '../models/File.js';
import Semester from '../models/Semester.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { parsePagination } from '../utils/pagination.js';
import { getEffectiveCourseIds } from '../services/courseAccessService.js';
import {
  RECENT_BATCH_LIMIT,
  recentBatches,
  contentCountsByBatch,
} from '../services/teachingService.js';

// GET /courses/mine — the courses a Student (or a "CR"-tier admin account,
// which keeps its department/batch/semester from before promotion) can
// actually submit material for: their own department's courses, plus any
// course they hold an active/approved CourseEnrollment for (e.g. a retake
// outside their own department). Same source of truth as File restrictions/
// Assignment/Quiz/Notice targeting — see courseAccessService.js.
//
// `?grouped=true` splits that into the two sections My Courses shows:
//   running — their department's courses for the semester they are currently
//             in (Course.semester is a free-text label that matches
//             Semester.name; it is the only link between the two the data has)
//   other   — active/approved *additional* enrolments (retake, improvement,
//             extra, backlog, advance), each labelled with its type. `regular`
//             is excluded because those are the running courses.
export const getMyCourses = asyncHandler(async (req, res) => {
  const courseIds = await getEffectiveCourseIds(req.user);
  const courses = await Course.find({ _id: { $in: courseIds }, status: 'active' })
    .populate('department', 'name code')
    .sort({ name: 1 });

  if (req.query.grouped !== 'true' && req.query.grouped !== '1') {
    return res.json({ success: true, data: courses });
  }

  const semester = req.user.semester
    ? await Semester.findById(req.user.semester).select('name')
    : null;
  const semesterName = semester?.name || '';
  const departmentId = String(req.user.department || '');

  const running = courses.filter(
    (course) =>
      semesterName &&
      String(course.department?._id || course.department) === departmentId &&
      course.semester === semesterName
  );

  const enrolments = await CourseEnrollment.find({
    student: req.user._id,
    enrollmentType: { $ne: 'regular' },
    status: { $in: ['active', 'approved'] },
  }).populate({
    path: 'course',
    select: 'name courseId semester status department',
    populate: { path: 'department', select: 'name code' },
  });

  const other = enrolments
    .filter((enrolment) => enrolment.course && enrolment.course.status === 'active')
    .map((enrolment) => ({
      course: enrolment.course,
      enrollmentType: enrolment.enrollmentType,
      academicYear: enrolment.academicYear || '',
      status: enrolment.status,
    }));

  res.json({ success: true, data: { running, other } });
});

// GET /courses/:courseId/batches — the batch selector for a course page.
//
// Only the most recent batches are returned, derived from the data on every
// call so a newly created batch displaces the oldest automatically. Each batch
// carries its content counts for this course so the selector can show where the
// material already is. A student's actual access to that content is enforced
// per batch by the file/assignment/quiz query builders, never by this list.
export const getCourseBatches = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.courseId)) {
    throw new ApiError(404, 'Course not found');
  }
  const course = await Course.findById(req.params.courseId).select('name courseId');
  if (!course) throw new ApiError(404, 'Course not found');

  const batches = await recentBatches(RECENT_BATCH_LIMIT);
  const counts = await contentCountsByBatch(course._id, batches.map((batch) => batch._id));

  res.json({
    success: true,
    data: batches.map((batch) => ({
      _id: batch._id,
      name: batch.name,
      code: batch.code,
      year: batch.year ?? null,
      counts: counts.get(String(batch._id)) || { files: 0, assignments: 0, quizzes: 0 },
    })),
  });
});

export const listCourses = asyncHandler(async (req, res) => {
  const { department } = req.query;
  const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50 });
  const filter = { status: 'active' };
  if (department) filter.department = department;

  const [courses, total] = await Promise.all([
    Course.find(filter).populate('department', 'name code').sort({ name: 1 }).skip(skip).limit(limit),
    Course.countDocuments(filter),
  ]);

  res.json({ success: true, data: courses, pagination: { page, limit, total } });
});

export const getCourse = asyncHandler(async (req, res) => {
  const course = await Course.findById(req.params.id).populate('department', 'name code');
  if (!course) throw new ApiError(404, 'Course not found');
  res.json({ success: true, data: course });
});

export const createCourse = asyncHandler(async (req, res) => {
  const course = await Course.create(req.body);
  res.status(201).json({ success: true, data: course });
});

export const updateCourse = asyncHandler(async (req, res) => {
  const course = await Course.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!course) throw new ApiError(404, 'Course not found');
  res.json({ success: true, data: course });
});

export const deleteCourse = asyncHandler(async (req, res) => {
  const inUse = await File.exists({ course: req.params.id });
  if (inUse) throw new ApiError(409, 'Cannot delete a course that still has files');

  const course = await Course.findByIdAndDelete(req.params.id);
  if (!course) throw new ApiError(404, 'Course not found');
  res.json({ success: true, message: 'Course deleted' });
});
