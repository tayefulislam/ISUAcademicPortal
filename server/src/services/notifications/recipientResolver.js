import User from '../../models/User.js';
import Course from '../../models/Course.js';
import CourseEnrollment, { ACCESS_GRANTING_STATUSES } from '../../models/CourseEnrollment.js';

// This module is the "smart recipient detection" piece — every resolver
// here reuses the app's existing course-access concepts instead of
// reinventing them:
//   - getEffectiveCourseIds (courseAccessService.js) answers "which courses
//     can THIS student reach" in the forward direction (per-student).
//   - resolveCourseScopedRecipients below is the reverse-direction mirror of
//     that same rule, batched for "which students can reach THIS course" —
//     needed because fan-out has to start from the course, not the student.

/**
 * Students who can reach `course` — union of (same-department students) and
 * (active/approved CourseEnrollment for this exact course), i.e. exactly the
 * population `getEffectiveCourseIds` would include this course for.
 */
async function studentsWithCourseAccess(course) {
  const [deptStudents, enrolledStudentIds] = await Promise.all([
    course.department ? User.find({ role: 'student', status: 'active', department: course.department }).distinct('_id') : [],
    CourseEnrollment.find({ course: course._id, status: { $in: ACCESS_GRANTING_STATUSES } }).distinct('student'),
  ]);
  return [...new Set([...deptStudents, ...enrolledStudentIds].map(String))];
}

/**
 * Resolves recipients for content scoped like File/Assignment/Quiz
 * targeting — AND across non-empty axes (department implied by course,
 * batches/semesters further narrow it), OR within an axis. Pass whichever
 * axes the content actually restricts by; omit the rest.
 *
 * @param {{course, batches?, semesters?}} scope - `course` is a populated
 *   Course doc or a course id; batches/semesters are arrays of ids.
 */
export async function resolveCourseScopedRecipients({ course, batches = [], semesters = [] }) {
  const courseDoc = course?._id ? course : await Course.findById(course).select('department');
  if (!courseDoc) return [];

  let studentIds = await studentsWithCourseAccess(courseDoc);
  if (!studentIds.length) return [];

  const extraFilter = { _id: { $in: studentIds } };
  if (batches.length) extraFilter.batch = { $in: batches };
  if (semesters.length) extraFilter.semester = { $in: semesters };

  const students = await User.find(extraFilter).select('_id notificationPreferences');
  return students.map((s) => s._id);
}

/**
 * Notice targeting — OR across axes (everyone short-circuits to
 * "every active student"), matching Notice.js's own documented semantics
 * exactly (see listRelevantNotices in noticeController.js).
 */
export async function resolveNoticeRecipients(targeting) {
  if (targeting.everyone) {
    return User.find({ role: 'student', status: 'active' }).distinct('_id');
  }

  const { departments = [], courses = [], batches = [], semesters = [] } = targeting;
  const or = [];
  if (departments.length) or.push({ department: { $in: departments } });
  if (batches.length) or.push({ batch: { $in: batches } });
  if (semesters.length) or.push({ semester: { $in: semesters } });

  let courseStudentIds = [];
  if (courses.length) {
    const courseDocs = await Course.find({ _id: { $in: courses } }).select('department');
    const perCourse = await Promise.all(courseDocs.map((c) => studentsWithCourseAccess(c)));
    courseStudentIds = [...new Set(perCourse.flat())];
  }

  if (!or.length && !courseStudentIds.length) return [];

  const idSet = new Set(courseStudentIds.map(String));
  if (or.length) {
    const matched = await User.find({ role: 'student', status: 'active', $or: or }).distinct('_id');
    matched.forEach((id) => idSet.add(String(id)));
  }
  return [...idSet];
}

/** A single explicit recipient (messages, direct grading, etc). */
export function resolveSingleUser(userId) {
  return userId ? [userId] : [];
}

/** Faculty assigned to (or overseeing) a course — for staff-facing events. */
export async function resolveFacultyForCourse(course) {
  const courseDoc = course?._id ? course : await Course.findById(course).select('department');
  if (!courseDoc) return [];
  return User.find({
    role: 'faculty',
    $or: [{ assignedCourses: courseDoc._id }, { assignedDepartments: courseDoc.department }],
  }).distinct('_id');
}

/** All active students + faculty — for admin "send to all". */
export async function resolveAllEligibleUsers() {
  return User.find({ status: 'active', role: { $in: ['student', 'faculty'] } }).distinct('_id');
}

/** Every active student/faculty in one department — for admin "send to department". */
export async function resolveDepartmentRecipients(departmentId) {
  return User.find({
    status: 'active',
    $or: [
      { role: 'student', department: departmentId },
      { role: 'faculty', assignedDepartments: departmentId },
    ],
  }).distinct('_id');
}
