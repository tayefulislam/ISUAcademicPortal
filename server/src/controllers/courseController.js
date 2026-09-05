import Course from '../models/Course.js';
import File from '../models/File.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

export const listCourses = asyncHandler(async (req, res) => {
  const { department, page = 1, limit = 50 } = req.query;
  const filter = { status: 'active' };
  if (department) filter.department = department;

  const skip = (Number(page) - 1) * Number(limit);
  const [courses, total] = await Promise.all([
    Course.find(filter).populate('department', 'name code').sort({ name: 1 }).skip(skip).limit(Number(limit)),
    Course.countDocuments(filter),
  ]);

  res.json({ success: true, data: courses, pagination: { page: Number(page), limit: Number(limit), total } });
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
