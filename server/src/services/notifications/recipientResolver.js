import User from '../../models/User.js';
import Course from '../../models/Course.js';
import CourseEnrollment, { ACCESS_GRANTING_STATUSES } from '../../models/CourseEnrollment.js';
import Role, { getRole } from '../../models/Role.js';
import { GROUP_BOTH } from '../../models/Settings.js';

// This module is the "smart recipient detection" piece — every resolver
// here reuses the app's existing course-access concepts instead of
// reinventing them:
//   - getEffectiveCourseIds (courseAccessService.js) answers "which courses
//     can THIS student reach" in the forward direction (per-student).
//   - resolveCourseScopedRecipients below is the reverse-direction mirror of
//     that same rule, batched for "which students can reach THIS course" —
//     needed because fan-out has to start from the course, not the student.

// Accepts either a course id or an already-populated Course document and
// always returns a real document with `.department` loaded.
//
// This used to be `course?._id ? course : await Course.findById(course)...`
// — intended as "if it's already a populated doc, use it as-is". That check
// is unsafe: every real call site passes a raw, UNPOPULATED Mongoose
// ObjectId (e.g. `file.course`, an item from `assignment.courses[]`), and
// Mongoose's ObjectId wrapper exposes a `._id` getter that returns itself —
// so `course?._id` was truthy even for a bare id, `courseDoc` ended up being
// the ObjectId itself (no `.department` field), and every department-based
// recipient query silently matched zero students. Checking `.department`
// instead (only ever present on a genuinely populated document, since the
// field is `required: true` on the schema) is unambiguous.
async function resolveCourseDoc(course) {
  if (course && course.department) return course;
  return Course.findById(course).select('department');
}

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
 * Students explicitly enrolled in `course` beyond their own cohort — the
 * additional-course types (retake/extra/backlog/improvement/advance). A stored
 * `regular` enrollment is left out deliberately: it is housekeeping for a course
 * the student already reaches by department, so it must not widen anything.
 */
async function additionalEnrolleeIds(courseId) {
  if (!courseId) return [];
  return CourseEnrollment.find({
    course: courseId,
    status: { $in: ACCESS_GRANTING_STATUSES },
    enrollmentType: { $ne: 'regular' },
  }).distinct('student');
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
  const courseDoc = await resolveCourseDoc(course);
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

/**
 * Students who should receive a class routine entry or an academic event.
 *
 * Two shapes, because not every entry has a course behind it:
 *  - with `course` — the same course-access rule as everything else
 *    (same-department active students UNION students with an access-granting
 *    enrolment);
 *  - with only `department` — every active student in that department, which is
 *    what a general academic event (an orientation, a deadline) addresses.
 *
 * Then AND-narrowed by batch, semester and group.
 *
 * `groups` is what the entry targets. A student whose own group is BOTH is in
 * the whole batch, so they are included for any target; a student in A1 is
 * included for an A1 entry (or a BOTH entry) and never for A2 — which is the
 * whole point of the group axis.
 *
 * Faculty are deliberately not included: a class reminder goes to the students
 * attending it. Faculty see their own timetable through the faculty view.
 */
export async function resolveRoutineAudience({
  course = null,
  department = null,
  batches = [],
  semesters = [],
  groups = [],
}) {
  let studentIds;
  let courseDoc = null;
  if (course) {
    courseDoc = await resolveCourseDoc(course);
    if (!courseDoc) return [];
    studentIds = await studentsWithCourseAccess(courseDoc);
  } else if (department) {
    studentIds = await User.find({ role: 'student', status: 'active', department }).distinct('_id');
  } else {
    return [];
  }
  if (!studentIds.length) return [];

  // The department axis is already spent by the base query when there is no
  // course, so the remainder is the batch/semester/group narrowing.
  const extraFilter = { _id: { $in: studentIds } };
  if (batches.length) extraFilter.batch = { $in: batches };
  if (semesters.length) extraFilter.semester = { $in: semesters };
  if (groups.length) {
    extraFilter.$or = [{ group: { $in: groups } }, { group: GROUP_BOTH }];
  }

  const students = await User.find(extraFilter).select('_id');
  const recipients = new Map(students.map((s) => [String(s._id), s._id]));

  // A student explicitly enrolled in this course beyond their own cohort
  // (retake/extra/backlog/improvement/advance) sees the class in their routine
  // whatever batch/semester it was scheduled for — see
  // academicEventService.audienceFilterFor, whose course clause this mirrors.
  // The reminder follows the routine, so those students are added here too,
  // under the same rule (only the group axis still applies). Purely additive:
  // it can only ever add a recipient.
  if (courseDoc) {
    const extraIds = await additionalEnrolleeIds(courseDoc._id);
    if (extraIds.length) {
      const extraQuery = { _id: { $in: extraIds }, role: 'student', status: 'active' };
      if (groups.length) {
        extraQuery.$or = [{ group: { $in: groups } }, { group: GROUP_BOTH }];
      }
      const extraStudents = await User.find(extraQuery).select('_id');
      extraStudents.forEach((s) => recipients.set(String(s._id), s._id));
    }
  }

  return [...recipients.values()];
}

/** The role keys whose holders work the material-review queue. */
async function reviewerRoleKeys() {
  // 'reviews' is the permission the /reviews routes gate on. The seeded 'admin'
  // role holds every permission and the super-admin tier bypasses permissions
  // entirely, so both are reviewers regardless of what the query returns.
  await getRole('admin'); // lazily seeds the admin role, if it isn't yet
  const granted = await Role.find({ permissions: 'reviews' }).distinct('key');
  return [...new Set([...granted, 'admin', 'super_admin', 'administrator'])];
}

/**
 * The people who should hear about a student's material submission — i.e. who
 * can act on it in the review queue. Mirrors reviewController's audience and
 * scoping: the super-admin tier and the unrestricted admin role see everything;
 * a custom admin-tier reviewer (e.g. "CR") only its assigned
 * Department(s)/Course(s).
 *
 * Faculty are excluded by default. The submission notice is for the reviewers
 * who work the queue, and faculty found the extra noise unwanted; `includeFaculty`
 * (driven by an env var) adds them back later with no code change.
 */
export async function resolveReviewersForCourse(course, { includeFaculty = false } = {}) {
  const courseDoc = await resolveCourseDoc(course);
  if (!courseDoc) return [];

  const scoped = [
    { assignedDepartments: courseDoc.department },
    { assignedCourses: courseDoc._id },
  ];

  const roles = await reviewerRoleKeys();
  const unrestricted = roles.filter((key) => key === 'admin' || key === 'super_admin' || key === 'administrator');
  const scopedRoles = roles.filter((key) => !unrestricted.includes(key));

  const or = [];
  if (unrestricted.length) or.push({ role: { $in: unrestricted } });
  if (scopedRoles.length) or.push({ role: { $in: scopedRoles }, $or: scoped });
  if (includeFaculty) or.push({ role: 'faculty', $or: scoped });
  if (!or.length) return [];

  return User.find({ $or: or }).distinct('_id');
}

/**
 * The role keys whose holders moderate content reports: the unrestricted
 * 'admin' role, the super-admin tier, plus any custom admin-tier role (e.g.
 * "CR") that has been granted the `reports` permission. Mirrors
 * reviewerRoleKeys — the same "seeded role + granted custom roles" pattern.
 */
async function moderatorRoleKeys() {
  await getRole('admin'); // lazily seeds the admin role, if it isn't yet
  const granted = await Role.find({ permissions: 'reports' }).distinct('key');
  return [...new Set([...granted, 'admin', 'super_admin', 'administrator'])];
}

/**
 * Everyone who should hear about a newly submitted content report: the CR
 * (reports-granted) / Admin / Administrator / Super Admin accounts. Faculty are
 * deliberately excluded — moderation is an admin-tier responsibility, not a
 * teaching one.
 */
export async function resolveModerators() {
  const roles = await moderatorRoleKeys();
  if (!roles.length) return [];
  return User.find({ role: { $in: roles }, status: 'active' }).distinct('_id');
}

/** Faculty assigned to (or overseeing) a course — for staff-facing events. */
export async function resolveFacultyForCourse(course) {
  const courseDoc = await resolveCourseDoc(course);
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
