// The building blocks an admin assembles an ISU document from.
//
// <p>These are DATA, not UI: the editor renders whatever this list contains, so
// adding a block — a new official line, a new ISU heading — is a change here and
// never a change to the React editor. Each block carries the coordinates it
// belongs at on an A4 cover, so clicking several of them lays the design out in
// its canonical places rather than stacking everything at the origin.
//
// <p>`field.type` drives everything downstream: an AUTO block is filled from the
// student/course record and locked, a USER_INPUT/DATE block is typed by the
// student, a STATIC block is fixed text, and LINE/BOX/IMAGE draw.

/** One selectable block: an identity plus the field definition it inserts. */
const BLOCKS = [
  // ---- ISU headings (fixed text) ----
  {
    id: 'university_name',
    label: 'University name',
    group: 'ISU headings',
    field: {
      key: 'university_name', label: 'University Name', type: 'STATIC',
      staticValue: 'International Standard University',
      x: 15, y: 22, width: 180, height: 10, fontSize: 18, bold: true, align: 'center',
    },
  },
  {
    id: 'department_label',
    label: 'Department of',
    group: 'ISU headings',
    field: {
      key: 'department_label', label: 'Department label', type: 'STATIC',
      staticValue: 'Department of',
      x: 15, y: 36, width: 180, height: 8, fontSize: 12, align: 'center',
    },
  },
  {
    id: 'experiment_title',
    label: 'Experiment title',
    group: 'ISU headings',
    field: {
      key: 'experiment_title', label: 'Experiment', type: 'STATIC',
      staticValue: 'Experiment',
      x: 15, y: 62, width: 180, height: 12, fontSize: 22, bold: true, align: 'center',
    },
  },
  {
    id: 'submitted_by',
    label: 'Submitted by',
    group: 'ISU headings',
    field: {
      key: 'submitted_by', label: 'Submitted by', type: 'STATIC',
      staticValue: 'Submitted by',
      x: 22, y: 140, width: 166, height: 9, fontSize: 14, bold: true,
    },
  },
  {
    id: 'submitted_to',
    label: 'Submitted to',
    group: 'ISU headings',
    field: {
      key: 'submitted_to', label: 'Submitted to', type: 'STATIC',
      staticValue: 'Submitted to',
      x: 22, y: 186, width: 166, height: 9, fontSize: 14, bold: true,
    },
  },

  // ---- Official details (auto-filled from the portal) ----
  {
    id: 'department_name',
    label: 'Department (name)',
    group: 'Official details',
    field: {
      key: 'department_name', label: 'Department', type: 'AUTO', source: 'department.name',
      x: 15, y: 44, width: 180, height: 9, fontSize: 14, bold: true, align: 'center',
    },
  },
  {
    id: 'department_code',
    label: 'Department code',
    group: 'Official details',
    field: {
      key: 'department_code', label: 'Department code', type: 'AUTO', source: 'department.code',
      formatting: { prefix: 'Department: ' },
      x: 22, y: 76, width: 166, height: 8, fontSize: 12,
    },
  },
  {
    id: 'course_code',
    label: 'Course code',
    group: 'Official details',
    field: {
      key: 'course_code', label: 'Course Code', type: 'AUTO', source: 'course.code',
      formatting: { prefix: 'Course Code: ' },
      x: 22, y: 84, width: 166, height: 8, fontSize: 12,
    },
  },
  {
    id: 'course_name',
    label: 'Course name',
    group: 'Official details',
    field: {
      key: 'course_name', label: 'Course Name', type: 'AUTO', source: 'course.name',
      formatting: { prefix: 'Course Name: ' },
      x: 22, y: 92, width: 166, height: 8, fontSize: 12,
    },
  },
  {
    id: 'course_credit',
    label: 'Course credit',
    group: 'Official details',
    field: {
      key: 'course_credit', label: 'Course Credit', type: 'AUTO', source: 'course.credit',
      formatting: { prefix: 'Credit: ' },
      x: 22, y: 100, width: 166, height: 8, fontSize: 12,
    },
  },
  {
    id: 'course_semester',
    label: 'Course semester',
    group: 'Official details',
    field: {
      key: 'course_semester', label: 'Course Semester', type: 'AUTO', source: 'course.semester',
      formatting: { prefix: 'Semester: ' },
      x: 22, y: 108, width: 166, height: 8, fontSize: 12,
    },
  },
  {
    id: 'student_name',
    label: 'Student name',
    group: 'Official details',
    field: {
      key: 'student_name', label: 'Student Name', type: 'AUTO', source: 'student.name',
      formatting: { prefix: 'Name: ' },
      x: 28, y: 150, width: 160, height: 8, fontSize: 12,
    },
  },
  {
    id: 'student_id',
    label: 'Student ID',
    group: 'Official details',
    field: {
      key: 'student_id', label: 'Student ID', type: 'AUTO', source: 'student.studentId',
      formatting: { prefix: 'ID No: ' },
      x: 28, y: 158, width: 160, height: 8, fontSize: 12,
    },
  },
  {
    id: 'batch',
    label: 'Batch',
    group: 'Official details',
    field: {
      key: 'batch', label: 'Batch', type: 'AUTO', source: 'student.batch',
      formatting: { prefix: 'Batch: ' },
      x: 28, y: 166, width: 160, height: 8, fontSize: 12,
    },
  },
  {
    id: 'group',
    label: 'Group / section',
    group: 'Official details',
    field: {
      key: 'group', label: 'Group', type: 'AUTO', source: 'student.group',
      formatting: { prefix: 'Group: ' },
      x: 28, y: 174, width: 160, height: 8, fontSize: 12,
    },
  },
  {
    id: 'teacher_name',
    label: "Teacher's name",
    group: 'Official details',
    field: {
      key: 'teacher_name', label: "Teacher's Name", type: 'AUTO', source: 'faculty.name',
      formatting: { prefix: "Teacher's Name: " },
      x: 28, y: 196, width: 160, height: 8, fontSize: 12,
    },
  },
  {
    id: 'teacher_designation',
    label: "Teacher's designation",
    group: 'Official details',
    field: {
      key: 'teacher_designation', label: "Teacher's Designation", type: 'AUTO', source: 'faculty.designation',
      formatting: { prefix: 'Designation: ' },
      x: 28, y: 204, width: 160, height: 8, fontSize: 12,
    },
  },

  // ---- Fill-in fields (typed by the student) ----
  {
    id: 'experiment_no',
    label: 'Experiment No (typed)',
    group: 'Fill-in fields',
    field: {
      key: 'experiment_no', label: 'Experiment No', type: 'USER_INPUT', required: true,
      formatting: { prefix: 'Experiment No: ' },
      x: 22, y: 120, width: 166, height: 8, fontSize: 12,
    },
  },
  {
    id: 'experiment_name',
    label: 'Experiment Name (typed)',
    group: 'Fill-in fields',
    field: {
      key: 'experiment_name', label: 'Experiment Name', type: 'USER_INPUT', required: true,
      formatting: { prefix: 'Experiment Name: ' },
      x: 22, y: 128, width: 166, height: 8, fontSize: 12,
    },
  },
  {
    id: 'experiment_date',
    label: 'Date of experiment',
    group: 'Fill-in fields',
    field: {
      key: 'experiment_date', label: 'Date of Experiment', type: 'DATE', required: true,
      formatting: { prefix: 'Date of Experiment: ', dateFormat: 'DD MMM YYYY' },
      x: 22, y: 216, width: 166, height: 8, fontSize: 12,
    },
  },
  {
    id: 'submission_date',
    label: 'Date of submission',
    group: 'Fill-in fields',
    field: {
      key: 'submission_date', label: 'Date of Submission', type: 'DATE', required: true,
      formatting: { prefix: 'Date of Submission: ', dateFormat: 'DD MMM YYYY' },
      x: 22, y: 224, width: 166, height: 8, fontSize: 12,
    },
  },
  {
    id: 'signature',
    label: 'Signature line',
    group: 'Fill-in fields',
    field: {
      key: 'signature', label: 'Signature', type: 'USER_INPUT',
      formatting: { prefix: 'Signature: ' },
      x: 22, y: 240, width: 166, height: 8, fontSize: 12,
    },
  },

  // ---- Layout ----
  {
    id: 'logo',
    label: 'University logo',
    group: 'Layout',
    field: {
      key: 'logo', label: 'University Logo', type: 'IMAGE', asset: 'logo.png',
      x: 16, y: 14, width: 30, height: 30, zIndex: 0,
    },
  },
  {
    id: 'header_rule',
    label: 'Header rule',
    group: 'Layout',
    field: {
      key: 'header_rule', label: 'Header rule', type: 'LINE',
      x: 20, y: 56, width: 170, height: 0.5, color: '#1f3288',
    },
  },
  {
    id: 'page_border',
    label: 'A4 page border',
    group: 'Layout',
    field: {
      key: 'page_border', label: 'Page border', type: 'BOX', borderWidth: 0.5, borderColor: '#111111',
      x: 0, y: 0, width: 210, height: 297, zIndex: 0,
    },
  },
];

export const FIELD_BLOCKS = BLOCKS;

export default { FIELD_BLOCKS };
