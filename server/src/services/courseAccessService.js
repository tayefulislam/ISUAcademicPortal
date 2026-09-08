import Course from '../models/Course.js';
import CourseEnrollment, { ACCESS_GRANTING_STATUSES } from '../models/CourseEnrollment.js';

/**
 * Single source of truth for "which courses can this student reach" —
 * everywhere that used to ask only `Course.find({department: user.department})`
 * (File restrictions, Assignment/Quiz targeting, Notice targeting) now asks
 * this instead. It's a pure UNION with that existing department-wide proxy —
 * course IDs are only ever ADDED, never removed, so a student with zero
 * CourseEnrollment records sees exactly what they saw before this feature
 * existed. An active/approved enrollment additionally grants access to a
 * course outside the student's own department/semester (e.g. a retake).
 *
 * @param {{_id, department}} user
 * @returns {Promise<string[]>} course id strings
 */
export async function getEffectiveCourseIds(user) {
  if (!user) return [];

  const deptCourseIds = user.department ? await Course.find({ department: user.department }).distinct('_id') : [];
  const enrolledCourseIds = await CourseEnrollment.find({
    student: user._id,
    status: { $in: ACCESS_GRANTING_STATUSES },
  }).distinct('course');

  return [...new Set([...deptCourseIds, ...enrolledCourseIds].map(String))];
}

/**
 * Reusable authorization helper for anywhere that just needs a yes/no on one
 * specific student+course pair, rather than a full effective-course-id list.
 */
export async function isStudentEnrolled(studentId, courseId) {
  if (!studentId || !courseId) return false;
  return CourseEnrollment.exists({
    student: studentId,
    course: courseId,
    status: { $in: ACCESS_GRANTING_STATUSES },
  }).then(Boolean);
}
