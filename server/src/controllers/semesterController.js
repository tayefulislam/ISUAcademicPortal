import Semester from '../models/Semester.js';
import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';

export const listSemesters = asyncHandler(async (req, res) => {
  const semesters = await Semester.find({ status: 'active' }).sort({ name: 1 });
  res.json({ success: true, data: semesters });
});

export const createSemester = asyncHandler(async (req, res) => {
  const { name, code } = req.body;
  const semester = await Semester.create({ name, code });
  res.status(201).json({ success: true, data: semester });
});

export const updateSemester = asyncHandler(async (req, res) => {
  const semester = await Semester.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });
  if (!semester) throw new ApiError(404, 'Semester not found');
  res.json({ success: true, data: semester });
});

export const deleteSemester = asyncHandler(async (req, res) => {
  const inUse = await User.exists({ semester: req.params.id });
  if (inUse) throw new ApiError(409, 'Cannot delete a semester that still has users assigned to it');

  const semester = await Semester.findByIdAndDelete(req.params.id);
  if (!semester) throw new ApiError(404, 'Semester not found');
  res.json({ success: true, message: 'Semester deleted' });
});
