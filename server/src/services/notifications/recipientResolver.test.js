import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../../test/dbTestUtils.js';
import User from '../../models/User.js';
import Department from '../../models/Department.js';
import Course from '../../models/Course.js';
import Batch from '../../models/Batch.js';
import Semester from '../../models/Semester.js';
import CourseEnrollment from '../../models/CourseEnrollment.js';
import {
  resolveCourseScopedRecipients,
  resolveNoticeRecipients,
  resolveSingleUser,
  resolveFacultyForCourse,
  resolveAllEligibleUsers,
  resolveDepartmentRecipients,
} from './recipientResolver.js';

// This suite is the "smart recipient detection" contract: given a course/
// notice-targeting/department, exactly the right users come back — no more,
// no less. It exercises real Mongoose queries against a disposable local
// MongoDB database (see dbTestUtils.js), not mocks, because the whole point
// of this module is that it mirrors the app's real access-control queries
// (getEffectiveCourseIds / File-Assignment-Quiz restriction semantics).

let dept, otherDept, course, batchA, batchB, semester1, semester2;
let studentInDept, blockedStudentInDept, studentOutsideDeptEnrolled, studentOutsideDeptNotEnrolled;
let faculty, facultyByCourse;

before(async () => {
  await connectTestDb('recipient-resolver');
});

after(async () => {
  await dropAndDisconnect();
});

beforeEach(async () => {
  await clearCollections(User, Department, Course, Batch, Semester, CourseEnrollment);

  dept = await Department.create({ name: 'Computer Science', code: 'CSE' });
  otherDept = await Department.create({ name: 'Civil Engineering', code: 'CE' });
  course = await Course.create({ name: 'Database Systems', courseId: 'CSE-301', department: dept._id });
  batchA = await Batch.create({ name: 'BATCH-A', code: 'BATCH-A' });
  batchB = await Batch.create({ name: 'BATCH-B', code: 'BATCH-B' });
  semester1 = await Semester.create({ name: '1st Semester', code: 'SEM-1' });
  semester2 = await Semester.create({ name: '2nd Semester', code: 'SEM-2' });

  const mkUser = (overrides) =>
    User.create({ name: 'Test User', email: `${Math.random().toString(36).slice(2)}@test.local`, password: 'password123', role: 'student', ...overrides });

  studentInDept = await mkUser({ department: dept._id, batch: batchA._id, semester: semester1._id });
  blockedStudentInDept = await mkUser({ department: dept._id, status: 'blocked' });
  studentOutsideDeptNotEnrolled = await mkUser({ department: otherDept._id });
  studentOutsideDeptEnrolled = await mkUser({ department: otherDept._id, batch: batchB._id, semester: semester2._id });
  await CourseEnrollment.create({
    student: studentOutsideDeptEnrolled._id,
    course: course._id,
    enrollmentType: 'retake',
    status: 'active',
    academicYear: '2025-2026',
    semester: semester2._id,
  });

  faculty = await User.create({ name: 'Faculty In Dept', email: 'faculty1@test.local', password: 'password123', role: 'faculty', assignedDepartments: [dept._id] });
  facultyByCourse = await User.create({ name: 'Faculty By Course', email: 'faculty2@test.local', password: 'password123', role: 'faculty', assignedCourses: [course._id] });
  await User.create({ name: 'Unrelated Faculty', email: 'faculty3@test.local', password: 'password123', role: 'faculty' });
});

describe('resolveCourseScopedRecipients', () => {
  test('includes a same-department student', async () => {
    const ids = (await resolveCourseScopedRecipients({ course })).map(String);
    assert.ok(ids.includes(String(studentInDept._id)));
  });

  test('excludes a blocked student even in the same department', async () => {
    const ids = (await resolveCourseScopedRecipients({ course })).map(String);
    assert.ok(!ids.includes(String(blockedStudentInDept._id)));
  });

  test('excludes a student in a different department with no enrollment', async () => {
    const ids = (await resolveCourseScopedRecipients({ course })).map(String);
    assert.ok(!ids.includes(String(studentOutsideDeptNotEnrolled._id)));
  });

  test('includes a student from a different department via an active CourseEnrollment (e.g. a retake)', async () => {
    const ids = (await resolveCourseScopedRecipients({ course })).map(String);
    assert.ok(ids.includes(String(studentOutsideDeptEnrolled._id)));
  });

  test('a pending (non-access-granting) enrollment does NOT grant access', async () => {
    const pendingStudent = await User.create({ name: 'Pending', email: 'pending@test.local', password: 'password123', role: 'student', department: otherDept._id });
    await CourseEnrollment.create({
      student: pendingStudent._id,
      course: course._id,
      enrollmentType: 'retake',
      status: 'pending',
      academicYear: '2025-2026',
      semester: semester2._id,
    });
    const ids = (await resolveCourseScopedRecipients({ course })).map(String);
    assert.ok(!ids.includes(String(pendingStudent._id)));
  });

  test('batch axis further narrows the AND-across-axes population', async () => {
    const ids = (await resolveCourseScopedRecipients({ course, batches: [batchA._id] })).map(String);
    assert.ok(ids.includes(String(studentInDept._id))); // batchA -> matches
    assert.ok(!ids.includes(String(studentOutsideDeptEnrolled._id))); // batchB -> filtered out
  });

  test('an unknown/deleted course resolves to no recipients, not an error', async () => {
    const ids = await resolveCourseScopedRecipients({ course: '000000000000000000000000' });
    assert.deepEqual(ids, []);
  });
});

describe('resolveNoticeRecipients (OR-across-axes)', () => {
  test('everyone:true returns every active student, ignoring other axes', async () => {
    const ids = (await resolveNoticeRecipients({ everyone: true, departments: [], courses: [], batches: [], semesters: [] })).map(String);
    assert.ok(ids.includes(String(studentInDept._id)));
    assert.ok(ids.includes(String(studentOutsideDeptNotEnrolled._id)));
    assert.ok(!ids.includes(String(blockedStudentInDept._id)));
  });

  test('department OR batch targeting reaches students matching EITHER axis (union, not intersection)', async () => {
    // studentOutsideDeptEnrolled is in otherDept and batchB; targeting
    // dept's department + a batch that only studentInDept belongs to must
    // still return studentOutsideDeptEnrolled purely via the batch axis
    // once its own batch is targeted, proving axes are OR'd together.
    const ids = (
      await resolveNoticeRecipients({ everyone: false, departments: [dept._id], courses: [], batches: [batchB._id], semesters: [] })
    ).map(String);
    assert.ok(ids.includes(String(studentInDept._id))); // via department axis
    assert.ok(ids.includes(String(studentOutsideDeptEnrolled._id))); // via batch axis alone
  });

  test('course targeting includes students with course access via enrollment, not just department', async () => {
    const ids = (await resolveNoticeRecipients({ everyone: false, departments: [], courses: [course._id], batches: [], semesters: [] })).map(String);
    assert.ok(ids.includes(String(studentInDept._id)));
    assert.ok(ids.includes(String(studentOutsideDeptEnrolled._id)));
    assert.ok(!ids.includes(String(studentOutsideDeptNotEnrolled._id)));
  });

  test('no axes and everyone:false resolves to no recipients', async () => {
    const ids = await resolveNoticeRecipients({ everyone: false, departments: [], courses: [], batches: [], semesters: [] });
    assert.deepEqual(ids, []);
  });
});

describe('resolveSingleUser', () => {
  test('wraps one id, or returns empty for a falsy id', () => {
    assert.deepEqual(resolveSingleUser('abc'), ['abc']);
    assert.deepEqual(resolveSingleUser(null), []);
  });
});

describe('resolveFacultyForCourse', () => {
  test('includes faculty assigned to the course directly', async () => {
    const ids = (await resolveFacultyForCourse(course)).map(String);
    assert.ok(ids.includes(String(facultyByCourse._id)));
  });

  test('includes faculty assigned to the course\'s department', async () => {
    const ids = (await resolveFacultyForCourse(course)).map(String);
    assert.ok(ids.includes(String(faculty._id)));
  });

  test('excludes faculty with no relevant assignment', async () => {
    const ids = (await resolveFacultyForCourse(course)).map(String);
    const unrelated = await User.findOne({ name: 'Unrelated Faculty' });
    assert.ok(!ids.includes(String(unrelated._id)));
  });
});

describe('resolveAllEligibleUsers / resolveDepartmentRecipients', () => {
  test('resolveAllEligibleUsers includes active students and faculty, excludes blocked', async () => {
    const ids = (await resolveAllEligibleUsers()).map(String);
    assert.ok(ids.includes(String(studentInDept._id)));
    assert.ok(ids.includes(String(faculty._id)));
    assert.ok(!ids.includes(String(blockedStudentInDept._id)));
  });

  test('resolveDepartmentRecipients matches students by department and faculty by assignedDepartments', async () => {
    const ids = (await resolveDepartmentRecipients(dept._id)).map(String);
    assert.ok(ids.includes(String(studentInDept._id)));
    assert.ok(ids.includes(String(faculty._id)));
    assert.ok(!ids.includes(String(studentOutsideDeptNotEnrolled._id)));
  });
});
