// The field vocabulary, kept in one dependency-free module so it can be
// imported by both the Mongoose model (for its enums) and the pure engine
// modules (for rendering/validation) without dragging Mongoose into a unit test.

/**
 * The kinds of field a template can define.
 *
 * <p>`BOX` is a drawn element with no value of its own — a border and/or shading
 * only. It exists so an admin can frame the page (an A4 border) or draw a
 * rectangle, which a text field cannot do: a text field with no value prints
 * nothing at all.
 */
export const FIELD_TYPES = ['AUTO', 'USER_INPUT', 'TEXT', 'DATE', 'NUMBER', 'IMAGE', 'STATIC', 'LINE', 'BOX'];

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
  'faculty.designation',
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
  'faculty.designation': "Teacher's Designation",
  'faculty.email': "Teacher's Email",
  'department.name': 'Department',
  'university.name': 'University Name',
};

/** The types whose value comes from the client rather than a record. */
export const EDITABLE_TYPES = ['USER_INPUT', 'TEXT', 'DATE', 'NUMBER'];

/**
 * The fonts an admin can set a document (or one element) in.
 *
 * <p>Each is a STACK, not a single name: the renderer runs in a container whose
 * exact font set is not knowable, so a missing first choice degrades to a
 * metric-compatible fallback rather than to a default face. The list is served
 * from here so the editor's picker cannot drift from what the renderer writes.
 */
export const FONT_CHOICES = [
  { value: '', label: 'Default (Helvetica / Arial)' },

  // Sans-serif.
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' },
  { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: 'Tahoma, Verdana, sans-serif', label: 'Tahoma' },
  { value: '"Segoe UI", Tahoma, sans-serif', label: 'Segoe UI' },
  { value: 'Calibri, Candara, "Segoe UI", sans-serif', label: 'Calibri' },
  { value: 'Candara, Calibri, sans-serif', label: 'Candara' },
  { value: '"Century Gothic", "Trebuchet MS", sans-serif', label: 'Century Gothic' },
  { value: '"Trebuchet MS", Tahoma, sans-serif', label: 'Trebuchet MS' },
  { value: '"Franklin Gothic Medium", "Arial Narrow", sans-serif', label: 'Franklin Gothic' },
  { value: '"Arial Narrow", Arial, sans-serif', label: 'Arial Narrow' },
  { value: '"Lucida Sans Unicode", "Lucida Grande", sans-serif', label: 'Lucida Sans' },

  // Serif.
  { value: '"Times New Roman", Times, serif', label: 'Times New Roman' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: 'Garamond, Georgia, serif', label: 'Garamond' },
  { value: '"Palatino Linotype", "Book Antiqua", Palatino, serif', label: 'Palatino Linotype' },
  { value: '"Book Antiqua", Palatino, serif', label: 'Book Antiqua' },
  { value: 'Cambria, Georgia, serif', label: 'Cambria' },
  { value: 'Constantia, Cambria, Georgia, serif', label: 'Constantia' },

  // Monospace.
  { value: '"Courier New", Courier, monospace', label: 'Courier New' },
  { value: 'Consolas, "Courier New", monospace', label: 'Consolas' },
  { value: '"Lucida Console", Monaco, monospace', label: 'Lucida Console' },

  // Display / script.
  { value: '"Brush Script MT", cursive', label: 'Brush Script' },
  { value: '"Comic Sans MS", "Chalkboard SE", cursive', label: 'Comic Sans MS' },
  { value: 'Impact, Haettenschweiler, sans-serif', label: 'Impact' },
  { value: '"Arial Black", Gadget, sans-serif', label: 'Arial Black' },
];

/** The border styles a box can draw. */
export const BORDER_STYLES = ['none', 'solid', 'dashed', 'dotted'];

export function isSource(value) {
  return FIELD_SOURCES.includes(value);
}
