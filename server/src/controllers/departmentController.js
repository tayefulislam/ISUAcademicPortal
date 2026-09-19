import Department from '../models/Department.js';
import Course from '../models/Course.js';
import File from '../models/File.js';
import RoutineTemplate from '../models/RoutineTemplate.js';
import ScheduleInstance from '../models/ScheduleInstance.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

export const listDepartments = asyncHandler(async (req, res) => {
  const departments = await Department.find({ status: 'active' }).sort({ name: 1 });
  res.json({ success: true, data: departments });
});

export const getDepartment = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department) throw new ApiError(404, 'Department not found');
  res.json({ success: true, data: department });
});

export const getDepartmentCourses = asyncHandler(async (req, res) => {
  const courses = await Course.find({ department: req.params.id, status: 'active' }).sort({ name: 1 });
  res.json({ success: true, data: courses });
});

export const createDepartment = asyncHandler(async (req, res) => {
  const { name, code, description } = req.body;
  const department = await Department.create({ name, code, description });
  res.status(201).json({ success: true, data: department });
});

export const updateDepartment = asyncHandler(async (req, res) => {
  const department = await Department.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!department) throw new ApiError(404, 'Department not found');
  res.json({ success: true, data: department });
});

export const deleteDepartment = asyncHandler(async (req, res) => {
  const inUse = await File.exists({ department: req.params.id });
  if (inUse) throw new ApiError(409, 'Cannot delete a department that still has files');

  // Same reason as a course: routine rules/occurrences reference the department
  // by id, and deleting it leaves them pointing at nothing — the class then
  // vanishes from every timetable.
  const [templates, instances] = await Promise.all([
    RoutineTemplate.countDocuments({ department: req.params.id }),
    ScheduleInstance.countDocuments({ department: req.params.id }),
  ]);
  const routineCount = templates + instances;
  if (routineCount > 0) {
    throw new ApiError(
      409,
      `Cannot delete a department that still has ${routineCount} class-routine entr${routineCount === 1 ? 'y' : 'ies'}. Retire them first.`
    );
  }

  const department = await Department.findByIdAndDelete(req.params.id);
  if (!department) throw new ApiError(404, 'Department not found');
  res.json({ success: true, message: 'Department deleted' });
});
