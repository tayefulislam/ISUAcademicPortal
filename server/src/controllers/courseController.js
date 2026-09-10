import Course from '../models/Course.js';
import File from '../models/File.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { parsePagination } from '../utils/pagination.js';
import { getEffectiveCourseIds } from '../services/courseAccessService.js';

// GET /courses/mine — the courses a Student (or a "CR"-tier admin account,
// which keeps its department/batch/semester from before promotion) can
// actually submit material for: their own department's courses, plus any
// course they hold an active/approved CourseEnrollment for (e.g. a retake
// outside their own department). Same source of truth as File restrictions/
// Assignment/Quiz/Notice targeting — see courseAccessService.js.
export const getMyCourses = asyncHandler(async (req, res) => {
  const courseIds = await getEffectiveCourseIds(req.user);
  const courses = await Course.find({ _id: { $in: courseIds }, status: 'active' })
    .populate('department', 'name code')
    .sort({ name: 1 });
  res.json({ success: true, data: courses });
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
