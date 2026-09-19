import Department from '../../models/Department.js';
import Batch from '../../models/Batch.js';
import Semester from '../../models/Semester.js';
import Course from '../../models/Course.js';

// The applicant's verified details, assembled from the authenticated user's own
// record. This is the ONLY source of the applicant's identity for the whole
// feature — the AI never receives an ID/name the client supplied, and a missing
// value is simply omitted rather than guessed.
//
// Deliberately limited to fields this database actually stores: there is no
// "program", "section" or "address" on User, so none is invented here.

/**
 * @param {object} user a hydrated User
 * @returns {Promise<object|null>} only the fields that exist, or null
 */
export async function buildProfileSnapshot(user) {
  if (!user) return null;

  const [department, batch, semester, courses] = await Promise.all([
    user.department ? Department.findById(user.department).select('name code').lean() : null,
    user.batch ? Batch.findById(user.batch).select('name code').lean() : null,
    user.semester ? Semester.findById(user.semester).select('name code').lean() : null,
    user.assignedCourses?.length
      ? Course.find({ _id: { $in: user.assignedCourses } }).select('name courseId').lean()
      : [],
  ]);

  const profile = {
    role: user.role || '',
    name: user.name || '',
    email: user.email || '',
  };
  if (user.rollNo) profile.studentId = user.rollNo;
  if (user.designation) profile.designation = user.designation;
  if (user.phone) profile.phone = user.phone;
  if (department) {
    profile.department = department.name;
    if (department.code) profile.departmentCode = department.code;
  }
  if (batch) profile.batch = batch.name || batch.code || '';
  if (semester) profile.semester = semester.name || semester.code || '';
  // BOTH means the whole batch, which is not a "section" worth printing.
  if (user.group && user.group !== 'BOTH') profile.group = user.group;
  if (courses.length) {
    profile.courses = courses.map((course) => (course.courseId ? `${course.courseId} — ${course.name}` : course.name));
  }
  return profile;
}

/** Label/value rows for the transparency preview (and the document header). */
export function profileRows(profile) {
  if (!profile) return [];
  const rows = [];
  const add = (label, value) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') rows.push({ label, value: String(value) });
  };
  add('Name', profile.name);
  add('Student ID', profile.studentId);
  add('Designation', profile.designation);
  add('Department', profile.department);
  add('Batch', profile.batch);
  add('Semester', profile.semester);
  // "BOTH" is not a section — it means the whole batch, so nothing prints.
  if (profile.group && profile.group !== 'BOTH') add('Section', profile.group);
  add('Email', profile.email);
  add('Phone', profile.phone);
  return rows;
}

/** The same rows as plain text for the AI prompt. */
export function profileText(profile) {
  return profileRows(profile)
    .map((row) => `${row.label}: ${row.value}`)
    .join('\n');
}

export default { buildProfileSnapshot, profileRows, profileText };
