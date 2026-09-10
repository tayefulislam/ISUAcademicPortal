import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Course from '../models/Course.js';
import Batch from '../models/Batch.js';
import Semester from '../models/Semester.js';
import CourseEnrollment from '../models/CourseEnrollment.js';
import { assertUploadScope } from './fileController.js';

// assertUploadScope is the gate closing the gap where a custom admin-tier
// role (e.g. "CR") with just the 'files' permission could previously upload
// into ANY department/course in the university by typing a different id —
// same "reachable courses" rule Submit Material already enforces
// (courseAccessService.js's getEffectiveCourseIds: own department's courses
// + any actively-enrolled extra/retake course). 'admin'/super_admin/
// administrator/faculty are all left unrestricted, matching their existing
// behavior exactly (faculty's own scoping is a separate, deliberately
// untouched follow-up).

function apiErrorStatus(fn) {
  return fn().then(
    () => null,
    (err) => err.statusCode
  );
}

before(async () => {
  await connectTestDb('file-upload-scope');
});

after(async () => {
  await dropAndDisconnect();
});

let deptA, deptB, courseInA, courseInB, batch, semester;
let crUser, adminUser, facultyUser, studentPromotedCr;

beforeEach(async () => {
  await clearCollections(User, Department, Course, Batch, Semester, CourseEnrollment);

  deptA = await Department.create({ name: 'Computer Science', code: 'CSE' });
  deptB = await Department.create({ name: 'Electrical Engineering', code: 'EEE' });
  courseInA = await Course.create({ name: 'Data Structures', courseId: 'CSE-301', department: deptA._id });
  courseInB = await Course.create({ name: 'Circuits', courseId: 'EEE-201', department: deptB._id });
  batch = await Batch.create({ name: 'BATCH-14', code: 'BATCH-14' });
  semester = await Semester.create({ name: '3rd Semester', code: 'SEM-3' });

  const mk = (overrides) =>
    User.create({ name: 'X', email: `${Math.random().toString(36).slice(2)}@test.local`, password: 'password123', role: 'student', ...overrides });

  crUser = await mk({ role: 'cr', department: deptA._id, batch: batch._id });
  adminUser = await mk({ role: 'admin', department: null });
  facultyUser = await mk({ role: 'faculty', department: null, assignedDepartments: [], assignedCourses: [] });
  studentPromotedCr = crUser;
});

describe('assertUploadScope', () => {
  test('admin can upload to any course regardless of department', async () => {
    assert.equal(await apiErrorStatus(() => assertUploadScope(adminUser, { department: deptB, course: courseInB })), null);
  });

  test('faculty is left unrestricted (existing behavior, deliberately unchanged here)', async () => {
    assert.equal(await apiErrorStatus(() => assertUploadScope(facultyUser, { department: deptB, course: courseInB })), null);
  });

  test('CR can upload to a course in their own department', async () => {
    assert.equal(await apiErrorStatus(() => assertUploadScope(crUser, { department: deptA, course: courseInA })), null);
  });

  test('CR cannot upload to a course outside their department with no enrollment -> 403', async () => {
    assert.equal(await apiErrorStatus(() => assertUploadScope(crUser, { department: deptB, course: courseInB })), 403);
  });

  test('CR CAN upload to an out-of-department course they hold an active/approved enrollment for (extra/retake)', async () => {
    await CourseEnrollment.create({
      student: studentPromotedCr._id,
      course: courseInB._id,
      enrollmentType: 'retake',
      status: 'active',
      academicYear: '2025-2026',
      semester: semester._id,
    });
    assert.equal(await apiErrorStatus(() => assertUploadScope(crUser, { department: deptB, course: courseInB })), null);
  });
});
