import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Course from '../models/Course.js';
import Batch from '../models/Batch.js';
import Semester from '../models/Semester.js';
import CourseEnrollment from '../models/CourseEnrollment.js';
import Notification from '../models/Notification.js';
import {
  derivedRegularEnrollments,
  listMyEnrollments,
  listMyActiveEnrollments,
  listMyPendingEnrollments,
  createEnrollmentDirect,
  bulkEnrollRegular,
} from './courseEnrollmentController.js';

// A student's CourseEnrollment rows only ever hold the explicit grants
// (retake/extra/backlog/improvement/advance, plus the administrative
// bulk-regular seeding tool). Their *regular* courses are the ones their own
// department teaches — which is exactly the set getEffectiveCourseIds already
// treats as reachable — so 'My Courses' has to derive them. Without this the
// screen reports "No courses yet" to a student who can open every course in
// their department.

before(async () => {
  await connectTestDb('course-enrollment');
});

after(async () => {
  await dropAndDisconnect();
});

let deptA, deptB, courseA1, courseA2, courseAInactive, courseB1, batch, semester;
let student, studentNoDept;

function fakeRes() {
  const res = {
    body: null,
    statusCode: 200,
    json(body) {
      this.body = body;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
  return res;
}

/** Runs an asyncHandler-wrapped controller and surfaces a rejection. */
async function invoke(handler, req) {
  const res = fakeRes();
  let failure = null;
  await handler(req, res, (err) => {
    failure = err;
  });
  if (failure) throw failure;
  return res.body;
}

beforeEach(async () => {
  await clearCollections(User, Department, Course, Batch, Semester, CourseEnrollment, Notification);

  deptA = await Department.create({ name: 'Computer Science', code: 'CSE' });
  deptB = await Department.create({ name: 'Electrical Engineering', code: 'EEE' });

  courseA1 = await Course.create({ name: 'Algorithms', courseId: 'CSE-301', department: deptA._id });
  courseA2 = await Course.create({ name: 'Databases', courseId: 'CSE-303', department: deptA._id });
  courseAInactive = await Course.create({
    name: 'Retired Course',
    courseId: 'CSE-999',
    department: deptA._id,
    status: 'inactive',
  });
  courseB1 = await Course.create({ name: 'Circuits', courseId: 'EEE-201', department: deptB._id });

  batch = await Batch.create({ name: 'BATCH-14', code: 'BATCH-14' });
  semester = await Semester.create({ name: '3rd Semester', code: 'SEM-3' });

  const mk = (overrides) =>
    User.create({
      name: 'Student',
      email: `${Math.random().toString(36).slice(2)}@test.local`,
      password: 'password123',
      role: 'student',
      ...overrides,
    });

  student = await mk({ department: deptA._id, batch: batch._id, semester: semester._id });
  studentNoDept = await mk({ department: null });
});

describe('derivedRegularEnrollments', () => {
  test('derives one regular row per active course in the student\'s own department', async () => {
    const derived = await derivedRegularEnrollments(student);

    const courseIds = derived.map((row) => String(row.course._id)).sort();
    assert.deepEqual(courseIds, [String(courseA1._id), String(courseA2._id)].sort());
  });

  test('excludes other departments and inactive courses', async () => {
    const derived = await derivedRegularEnrollments(student);

    const courseIds = derived.map((row) => String(row.course._id));
    assert.ok(!courseIds.includes(String(courseB1._id)), 'course from another department must not be derived');
    assert.ok(!courseIds.includes(String(courseAInactive._id)), 'inactive course must not be derived');
  });

  test('shapes a derived row like the populated enrollments the clients already parse', async () => {
    const derived = await derivedRegularEnrollments(student);
    const row = derived.find((r) => String(r.course._id) === String(courseA2._id));

    assert.ok(row, 'expected a derived row for Databases');
    assert.equal(row.enrollmentType, 'regular');
    assert.equal(row.status, 'active');
    assert.equal(row.derived, true);
    assert.equal(row._id, `regular-${row.course._id}`);
    assert.equal(row.course.name, 'Databases');
    assert.equal(row.course.courseId, 'CSE-303');
    assert.equal(row.course.department.code, 'CSE');
    assert.equal(row.semester.name, '3rd Semester');
    assert.equal(row.batch.name, 'BATCH-14');
    assert.deepEqual(row.history, []);
    assert.equal(row.registeredAt, undefined, 'a derived course was never requested, so it carries no request date');
    assert.match(row.academicYear, /^\d{4}-\d{4}$/);
  });

  test('a course with a stored row is never also derived — even a dropped one', async () => {
    await CourseEnrollment.create({
      student: student._id,
      course: courseA1._id,
      enrollmentType: 'regular',
      status: 'dropped',
      academicYear: '2025-2026',
      semester: semester._id,
    });

    const derived = await derivedRegularEnrollments(student);
    const courseIds = derived.map((row) => String(row.course._id));

    assert.ok(!courseIds.includes(String(courseA1._id)), 'a dropped enrollment must not be re-asserted as active');
    assert.deepEqual(courseIds, [String(courseA2._id)]);
  });

  test('a user with no department derives nothing', async () => {
    assert.deepEqual(await derivedRegularEnrollments(studentNoDept), []);
  });
});

describe('listMine', () => {
  test('merges stored rows with the derived department courses', async () => {
    const extra = await CourseEnrollment.create({
      student: student._id,
      course: courseB1._id,
      enrollmentType: 'retake',
      status: 'active',
      academicYear: '2025-2026',
      semester: semester._id,
    });

    const body = await invoke(listMyEnrollments, { user: student });

    const ids = body.data.map((row) => String(row._id));
    assert.ok(ids.includes(String(extra._id)), 'the stored retake must still be returned');
    assert.ok(ids.includes(`regular-${courseA1._id}`), 'department courses must be returned');
    assert.equal(body.data.length, 3);
  });

  test('/my/active returns the derived regular courses (they grant access)', async () => {
    const body = await invoke(listMyActiveEnrollments, { user: student });

    const ids = body.data.map((row) => row._id).sort();
    assert.deepEqual(ids, [`regular-${courseA1._id}`, `regular-${courseA2._id}`].sort());
  });

  test('/my/pending returns no derived rows — an active course is not a pending request', async () => {
    await CourseEnrollment.create({
      student: student._id,
      course: courseB1._id,
      enrollmentType: 'backlog',
      status: 'pending',
      academicYear: '2025-2026',
      semester: semester._id,
      reason: 'failed earlier',
    });

    const body = await invoke(listMyPendingEnrollments, { user: student });

    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].enrollmentType, 'backlog');
    assert.ok(!body.data.some((row) => row.derived), 'derived rows are active, never pending');
  });
});

/** Polls for a row the controller writes fire-and-forget (it must not block the response). */
async function waitFor(fn, { tries = 40, delayMs = 25 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    const found = await fn();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

describe('staff-initiated enrollment', () => {
  test('a direct enrollment tells the student they are now enrolled', async () => {
    const admin = await User.create({
      name: 'Admin', email: `admin-${Math.random().toString(36).slice(2)}@test.local`,
      password: 'password123', role: 'admin',
    });

    await invoke(createEnrollmentDirect, {
      user: admin,
      body: {
        studentId: String(student._id),
        courseId: String(courseA1._id),
        enrollmentType: 'extra',
        academicYear: '2026-2027',
        semesterId: String(semester._id),
      },
    });

    // The path had no notification at all before: no request, so neither
    // JOIN_REQUEST nor JOIN_REQUEST_APPROVED applies.
    const notice = await waitFor(() =>
      Notification.findOne({ recipient: student._id, type: 'COURSE_ENROLLED' })
    );
    assert.ok(notice, 'the student must be told they were enrolled');
    assert.equal(notice.url, `/student/courses/${courseA1._id}`);
  });

  test('bulk regular enrollment notifies every student it enrolls', async () => {
    const admin = await User.create({
      name: 'Admin', email: `admin-${Math.random().toString(36).slice(2)}@test.local`,
      password: 'password123', role: 'admin',
    });
    const other = await User.create({
      name: 'Other', email: `other-${Math.random().toString(36).slice(2)}@test.local`,
      password: 'password123', role: 'student', department: deptA._id, batch: batch._id, semester: semester._id,
    });

    await invoke(bulkEnrollRegular, {
      user: admin,
      body: {
        courseId: String(courseA2._id),
        batchId: String(batch._id),
        semesterId: String(semester._id),
        academicYear: '2026-2027',
      },
    });

    const notified = await waitFor(async () => {
      const count = await Notification.countDocuments({ type: 'COURSE_ENROLLED' });
      return count === 2 ? count : null;
    });
    assert.equal(notified, 2, 'both students in the batch are told');
  });
});
