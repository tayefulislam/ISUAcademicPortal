import Course from '../models/Course.js';
import CourseEnrollment, { ACCESS_GRANTING_STATUSES } from '../models/CourseEnrollment.js';
import { getSettings } from '../models/Settings.js';
import { isSuperAdminTier } from '../models/Role.js';

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

  // Super Admin / Administrator are unrestricted: they reach EVERY active
  // course, not a department's. Without this they have no department — and
  // therefore no reachable course at all — which is what left them unable to
  // use Submit Material, whose course picker and reachability check both come
  // from this list.
  if (isSuperAdminTier(user.role)) {
    const all = await Course.find({ status: 'active' }).distinct('_id');
    return all.map(String);
  }

  const deptCourseIds = user.department ? await Course.find({ department: user.department }).distinct('_id') : [];
  const enrolledCourseIds = await CourseEnrollment.find({
    student: user._id,
    status: { $in: ACCESS_GRANTING_STATUSES },
  }).distinct('course');

  return [...new Set([...deptCourseIds, ...enrolledCourseIds].map(String))];
}

/**
 * Course ids a student has been explicitly enrolled in *beyond* their own
 * department's course list — the additional-course types (retake, extra,
 * backlog, improvement, advance). A stored `regular` enrollment is excluded on
 * purpose: it is administrative housekeeping for a course the student already
 * reaches by department, so it must not reopen the cohort axes (see
 * academicEventService.audienceFilterFor, which treats these as their own grant
 * and lets the scheduled class appear whatever batch/semester it sits in).
 *
 * @param {{_id}} user
 * @returns {Promise<string[]>} course id strings
 */
export async function getAdditionalCourseIds(user) {
  if (!user) return [];

  const ids = await CourseEnrollment.find({
    student: user._id,
    status: { $in: ACCESS_GRANTING_STATUSES },
    enrollmentType: { $ne: 'regular' },
  }).distinct('course');

  return ids.map(String);
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

/**
 * True only for a 'student' whose Student ID hasn't been approved yet, and
 * only while the global approval system is ON — the single gate everything
 * that requires login (File content, Assignment submission, Quiz attempts,
 * Messaging) checks before letting a student in. A pending/rejected student
 * can still sign in and browse fully public (no-login-required) content;
 * this is what blocks everything else until an Admin approves them.
 */
export async function isBlockedByApproval(user) {
  if (!user || user.role !== 'student') return false;
  const settings = await getSettings();
  return !!settings.studentApprovalEnabled && user.approvalStatus !== 'approved';
}
