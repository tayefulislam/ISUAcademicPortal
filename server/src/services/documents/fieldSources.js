// The field vocabulary, kept in one dependency-free module so it can be
// imported by both the Mongoose model (for its enums) and the pure engine
// modules (for rendering/validation) without dragging Mongoose into a unit test.

/** The kinds of field a template can define. */
export const FIELD_TYPES = ['AUTO', 'USER_INPUT', 'TEXT', 'DATE', 'NUMBER', 'IMAGE', 'STATIC'];

/**
 * Every value a field's `source` may take. Each one is resolved server-side
 * from the authenticated user's own records — a field cannot name an arbitrary
 * path (no `student.password`, no dotted traversal into anything else), and a
 * client can never supply a value for one of these, so official academic data
 * stays read-only by construction.
 */
export const FIELD_SOURCES = [
  'student.name',
  'student.studentId',
  'student.batch',
  'student.group',
  'student.department',
  'student.semester',
  'course.code',
  'course.name',
  'course.department',
  'faculty.name',
  'faculty.email',
  'department.name',
  'university.name',
];

/** Human labels for the source dropdown in the admin editor. */
export const SOURCE_LABELS = {
  'student.name': 'Student Name',
  'student.studentId': 'Student ID',
  'student.batch': 'Batch',
  'student.group': 'Group',
  'student.department': 'Student Department',
  'student.semester': 'Semester',
  'course.code': 'Course Code',
  'course.name': 'Course Name',
  'course.department': 'Course Department',
  'faculty.name': "Teacher's Name",
  'faculty.email': "Teacher's Email",
  'department.name': 'Department',
  'university.name': 'University Name',
};

/** The types whose value comes from the client rather than a record. */
export const EDITABLE_TYPES = ['USER_INPUT', 'TEXT', 'DATE', 'NUMBER'];

export function isSource(value) {
  return FIELD_SOURCES.includes(value);
}
