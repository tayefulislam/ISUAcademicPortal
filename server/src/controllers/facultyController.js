import Course from '../models/Course.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// GET /faculty/courses — every course the Faculty member is authorized to
// work with: courses assigned to them directly, plus every course in a
// department assigned to them wholesale.
export const getFacultyCourses = asyncHandler(async (req, res) => {
  const courses = await Course.find({
    status: 'active',
    $or: [
      { _id: { $in: req.user.assignedCourses || [] } },
      { department: { $in: req.user.assignedDepartments || [] } },
    ],
  })
    .populate('department', 'name code')
    .sort({ name: 1 });

  res.json({ success: true, data: courses });
});
