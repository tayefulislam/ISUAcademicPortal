import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Batch from '../models/Batch.js';
import Course from '../models/Course.js';
import CourseEnrollment from '../models/CourseEnrollment.js';
// Not used directly in this file, but studentApprovalController.js's
// POPULATE list includes 'semester' — Mongoose needs the schema registered
// in this test process (each test file runs in its own worker) or populate
// throws MissingSchemaError.
import Semester from '../models/Semester.js';
import { listPendingStudents, approveStudent, rejectStudent, submitStudentId } from './studentApprovalController.js';

// Exercises the controllers directly (asyncHandler wraps (req,res,next) =>
// Promise.resolve(fn(...)).catch(next), so a thrown ApiError never rejects
// the call here — it's forwarded to `next`) against a real disposable
// MongoDB — same convention as authController.test.js. This is the CR
// department+batch scoping contract from the access-control spec: a CR must
// see and act on ONLY pending students in their own department+batch, never
// anything else, and never via query-param manipulation.

function fakeRes() {
  const res = { statusCode: 200 };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

async function call(fn, { user, params = {}, query = {}, body = {}, file = undefined }) {
  const req = { user, params, query, body, file };
  const res = fakeRes();
  let error;
  await fn(req, res, (err) => {
    error = err;
  });
  return { res, error };
}

before(async () => {
  await connectTestDb('student-approval-cr-scope');
});

after(async () => {
  await dropAndDisconnect();
});

let deptA, deptB, batch14, batch15, semester1, courseInA, courseInB;
let crA14, adminUser, superAdminUser, administratorUser;
let facultyDeptA, facultyCourseBOnly;
let studentA14Pending, studentA15Pending, studentB14Pending, studentA14Approved;

beforeEach(async () => {
  await clearCollections(User, Department, Batch, Course, CourseEnrollment, Semester);

  deptA = await Department.create({ name: 'Computer Science', code: 'CSE' });
  deptB = await Department.create({ name: 'Electrical Engineering', code: 'EEE' });
  batch14 = await Batch.create({ name: 'BATCH-14', code: 'BATCH-14' });
  batch15 = await Batch.create({ name: 'BATCH-15', code: 'BATCH-15' });
  semester1 = await Semester.create({ name: '1st Semester', code: 'SEM-1' });
  courseInA = await Course.create({ name: 'Data Structures', courseId: 'CSE-301', department: deptA._id });
  courseInB = await Course.create({ name: 'Circuits', courseId: 'EEE-201', department: deptB._id });

  const mk = (overrides) =>
    User.create({ name: 'X', email: `${Math.random().toString(36).slice(2)}@test.local`, password: 'password123', role: 'student', ...overrides });

  // Registration no longer collects a Student ID photo, so listPendingStudents
  // only surfaces a 'pending' student who has actually submitted one (see
  // that function's own comment) — every fixture below that's meant to
  // appear in a reviewer's queue needs a stand-in studentIdImage.
  const submittedImage = { provider: 's3', url: '', key: 'private/student-ids/fake.jpg', bucket: 'test-bucket', size: 12345, mimeType: 'image/jpeg', uploadedAt: new Date() };
  const mkSubmitted = (overrides) => mk({ studentIdImage: submittedImage, ...overrides });

  crA14 = await mk({ role: 'cr', department: deptA._id, batch: batch14._id });
  adminUser = await mk({ role: 'admin' });
  superAdminUser = await mk({ role: 'super_admin' });
  administratorUser = await mk({ role: 'administrator' });
  // Assigned to deptA directly — matches any student whose department is A,
  // regardless of course/batch (isFacultyScopedToFile-style OR match).
  facultyDeptA = await mk({ role: 'faculty', department: null, assignedDepartments: [deptA._id], assignedCourses: [] });
  // Assigned to one course in deptB only, no department assignment — only
  // matches a student who can actually reach that specific course.
  facultyCourseBOnly = await mk({ role: 'faculty', department: null, assignedDepartments: [], assignedCourses: [courseInB._id] });

  studentA14Pending = await mkSubmitted({ department: deptA._id, batch: batch14._id, approvalStatus: 'pending' });
  studentA15Pending = await mkSubmitted({ department: deptA._id, batch: batch15._id, approvalStatus: 'pending' });
  studentB14Pending = await mkSubmitted({ department: deptB._id, batch: batch14._id, approvalStatus: 'pending' });
  studentA14Approved = await mk({ department: deptA._id, batch: batch14._id, approvalStatus: 'approved' });
});

describe('listPendingStudents — CR department+batch scoping', () => {
  test('CR sees only pending students in their own department+batch', async () => {
    const { res, error } = await call(listPendingStudents, { user: crA14 });
    assert.equal(error, undefined);
    const ids = res.body.data.map((s) => s._id.toString());
    assert.deepEqual(ids.sort(), [studentA14Pending._id.toString()].sort());
  });

  test('CR cannot widen the queue via department/batch query-param manipulation', async () => {
    const { res, error } = await call(listPendingStudents, {
      user: crA14,
      query: { department: deptB._id.toString(), batch: batch15._id.toString() },
    });
    assert.equal(error, undefined);
    // Still only their own scope — the query params must be silently ignored.
    const ids = res.body.data.map((s) => s._id.toString());
    assert.deepEqual(ids, [studentA14Pending._id.toString()]);
  });

  test('Admin sees the full system-wide pending queue with no forced scope', async () => {
    const { res } = await call(listPendingStudents, { user: adminUser });
    const ids = res.body.data.map((s) => s._id.toString()).sort();
    assert.deepEqual(ids, [studentA14Pending._id, studentA15Pending._id, studentB14Pending._id].map(String).sort());
  });

  test('a "pending" student who has NOT submitted a Student ID photo yet does not appear in any reviewer queue (nothing to review)', async () => {
    const notYetSubmitted = await User.create({
      name: 'Not Submitted',
      email: `${Math.random().toString(36).slice(2)}@test.local`,
      password: 'password123',
      role: 'student',
      department: deptA._id,
      batch: batch14._id,
      approvalStatus: 'pending', // exactly what register() leaves a non-official-email student in now
    });
    const { res } = await call(listPendingStudents, { user: adminUser });
    const ids = res.body.data.map((s) => s._id.toString());
    assert.ok(!ids.includes(notYetSubmitted._id.toString()));
  });

  test('Super Admin / Administrator can optionally filter by department/batch/semester', async () => {
    const { res } = await call(listPendingStudents, { user: superAdminUser, query: { department: deptB._id.toString() } });
    assert.deepEqual(res.body.data.map((s) => s._id.toString()), [studentB14Pending._id.toString()]);

    const { res: res2 } = await call(listPendingStudents, { user: administratorUser, query: { batch: batch15._id.toString() } });
    assert.deepEqual(res2.body.data.map((s) => s._id.toString()), [studentA15Pending._id.toString()]);
  });
});

describe('approveStudent / rejectStudent — CR department+batch scoping', () => {
  test('CR can approve a student in the same department+batch', async () => {
    const { res, error } = await call(approveStudent, { user: crA14, params: { id: studentA14Pending._id.toString() } });
    assert.equal(error, undefined);
    assert.equal(res.body.data.approvalStatus, 'approved');
  });

  test('CR cannot approve a student in a different batch, same department -> 403', async () => {
    const { error } = await call(approveStudent, { user: crA14, params: { id: studentA15Pending._id.toString() } });
    assert.equal(error?.statusCode, 403);
  });

  test('CR cannot approve a student in a different department, same batch -> 403', async () => {
    const { error } = await call(approveStudent, { user: crA14, params: { id: studentB14Pending._id.toString() } });
    assert.equal(error?.statusCode, 403);
  });

  test('CR cannot reject a student outside their department+batch -> 403', async () => {
    const { error } = await call(rejectStudent, { user: crA14, params: { id: studentB14Pending._id.toString() } });
    assert.equal(error?.statusCode, 403);
  });

  test('CR cannot approve a student who is not pending (already approved) -> 400', async () => {
    const { error } = await call(approveStudent, { user: crA14, params: { id: studentA14Approved._id.toString() } });
    assert.equal(error?.statusCode, 400);
  });

  test('Admin can approve a student in any department/batch', async () => {
    const { res, error } = await call(approveStudent, { user: adminUser, params: { id: studentB14Pending._id.toString() } });
    assert.equal(error, undefined);
    assert.equal(res.body.data.approvalStatus, 'approved');
  });

  test('approval records approvedBy/approvedAt/approvalRole', async () => {
    await call(approveStudent, { user: crA14, params: { id: studentA14Pending._id.toString() } });
    const fresh = await User.findById(studentA14Pending._id);
    assert.equal(String(fresh.approvedBy), String(crA14._id));
    assert.equal(fresh.approvalRole, 'cr');
    assert.ok(fresh.approvedAt instanceof Date);
  });

  test('approval bumps tokenVersion so the student\'s existing token is invalidated', async () => {
    const before = studentA14Pending.tokenVersion;
    await call(approveStudent, { user: crA14, params: { id: studentA14Pending._id.toString() } });
    const fresh = await User.findById(studentA14Pending._id);
    assert.equal(fresh.tokenVersion, before + 1);
  });
});

describe('rejectStudent — reason, history, and image cleanup', () => {
  test('rejection stores the reviewer-entered reason and appends approvalHistory', async () => {
    const { res, error } = await call(rejectStudent, {
      user: adminUser,
      params: { id: studentA14Pending._id.toString() },
      body: { reason: 'Student ID picture is not readable.' },
    });
    assert.equal(error, undefined);
    assert.equal(res.body.data.approvalStatus, 'rejected');
    assert.equal(res.body.data.rejectionReason, 'Student ID picture is not readable.');

    const fresh = await User.findById(studentA14Pending._id);
    const last = fresh.approvalHistory.at(-1);
    assert.equal(last.action, 'REJECTED');
    assert.equal(last.reason, 'Student ID picture is not readable.');
    assert.equal(String(last.performedBy), String(adminUser._id));
  });

  test('rejection without a reason leaves rejectionReason empty rather than erroring', async () => {
    const { res, error } = await call(rejectStudent, { user: adminUser, params: { id: studentA14Pending._id.toString() } });
    assert.equal(error, undefined);
    assert.equal(res.body.data.rejectionReason, '');
  });

  test('rejection clears the stored studentIdImage (no image left referenced after rejection)', async () => {
    studentA14Pending.studentIdImage = {
      provider: 'imgbb',
      url: 'https://i.ibb.co/fake.jpg',
      key: 'https://ibb.co/delete/fake-token',
      bucket: '',
      size: 12345,
      mimeType: 'image/jpeg',
      uploadedAt: new Date(),
    };
    await studentA14Pending.save();

    await call(rejectStudent, { user: adminUser, params: { id: studentA14Pending._id.toString() } });
    const fresh = await User.findById(studentA14Pending._id).select('+studentIdImage.key');
    assert.equal(fresh.studentIdImage.key, '');
    assert.equal(fresh.studentIdImage.provider, '');
  });

  test('rejecting an already-rejected student -> 400 (must resubmit first)', async () => {
    await call(rejectStudent, { user: adminUser, params: { id: studentA14Pending._id.toString() } });
    const { error } = await call(rejectStudent, { user: adminUser, params: { id: studentA14Pending._id.toString() } });
    assert.equal(error?.statusCode, 400);
  });
});

describe('Faculty approval scope — department OR effective-course match', () => {
  test('Faculty assigned to the student\'s department can list, approve, and reject that student', async () => {
    const { res, error } = await call(listPendingStudents, { user: facultyDeptA });
    assert.equal(error, undefined);
    const ids = res.body.data.map((s) => s._id.toString()).sort();
    // deptA has studentA14Pending and studentA15Pending (studentB14Pending is deptB)
    assert.deepEqual(ids, [studentA14Pending._id.toString(), studentA15Pending._id.toString()].sort());

    const approve = await call(approveStudent, { user: facultyDeptA, params: { id: studentA14Pending._id.toString() } });
    assert.equal(approve.error, undefined);
    assert.equal(approve.res.body.data.approvalRole, 'faculty');
  });

  test('Faculty assigned to the student\'s department can reject with a reason', async () => {
    const { error, res } = await call(rejectStudent, {
      user: facultyDeptA,
      params: { id: studentA15Pending._id.toString() },
      body: { reason: 'Blurry photo' },
    });
    assert.equal(error, undefined);
    assert.equal(res.body.data.rejectionReason, 'Blurry photo');
  });

  test('Faculty outside the student\'s department, with no matching course enrollment -> 403', async () => {
    const { error } = await call(approveStudent, { user: facultyCourseBOnly, params: { id: studentA14Pending._id.toString() } });
    assert.equal(error?.statusCode, 403);
  });

  test('Faculty assigned to a course the student can reach via department (own dept course) can approve', async () => {
    // facultyCourseBOnly is assigned to courseInB (deptB). studentB14Pending
    // is IN deptB, so courseInB is part of their department's own courses —
    // reachable via getEffectiveCourseIds without any explicit enrollment.
    const { error, res } = await call(approveStudent, { user: facultyCourseBOnly, params: { id: studentB14Pending._id.toString() } });
    assert.equal(error, undefined);
    assert.equal(res.body.data.approvalStatus, 'approved');
  });

  test('Faculty assigned to a course outside the student\'s department, but the student holds an active enrollment in it -> approval allowed', async () => {
    await CourseEnrollment.create({
      student: studentA14Pending._id,
      course: courseInB._id,
      enrollmentType: 'extra',
      status: 'active',
      academicYear: '2025-2026',
      semester: semester1._id,
    });
    const { error, res } = await call(approveStudent, { user: facultyCourseBOnly, params: { id: studentA14Pending._id.toString() } });
    assert.equal(error, undefined);
    assert.equal(res.body.data.approvalStatus, 'approved');
  });

  test('listPendingStudents for Faculty ignores department/batch query-param manipulation (still scope-derived)', async () => {
    const { res, error } = await call(listPendingStudents, {
      user: facultyCourseBOnly,
      query: { department: deptA._id.toString(), batch: batch14._id.toString() },
    });
    assert.equal(error, undefined);
    // facultyCourseBOnly's real scope only reaches studentB14Pending (own-department course match)
    assert.deepEqual(res.body.data.map((s) => s._id.toString()), [studentB14Pending._id.toString()]);
  });
});

describe('submitStudentId — guard clauses (no network/storage calls exercised)', () => {
  test('a "pending" student (first-ever submission — never submitted before) passes the status guard and only fails for lack of a file', async () => {
    // studentA14Pending never had a status *set* to rejected — this exercises
    // exactly the case registration now leaves every non-official-email
    // student in: 'pending' with no image on file yet. If the old
    // rejected-only guard were still in place this would 400 with "not
    // required" instead of "photo required".
    const { error } = await call(submitStudentId, { user: studentA14Pending }); // no file attached
    assert.equal(error?.statusCode, 400);
    assert.match(error.message, /photo is required/i);
  });

  test('an approved student cannot submit — Student ID verification is not required for them -> 400', async () => {
    const { error } = await call(submitStudentId, {
      user: studentA14Approved,
      file: { buffer: Buffer.from('fake'), originalname: 'id.jpg', mimetype: 'image/jpeg' },
    });
    assert.equal(error?.statusCode, 400);
    assert.match(error.message, /not required/i);
  });

  test('resubmitting (status already rejected) without a file -> 400', async () => {
    studentA14Pending.approvalStatus = 'rejected';
    await studentA14Pending.save();
    const { error } = await call(submitStudentId, { user: studentA14Pending });
    assert.equal(error?.statusCode, 400);
    assert.match(error.message, /photo is required/i);
  });

  test('identity is always the authenticated session (req.user), never a params id — there is no :id on this route', async () => {
    // submitStudentId never reads req.params at all; confirm it resolves
    // strictly from req.user._id by pointing params at a completely
    // different (approved) student and confirming that student is
    // untouched regardless.
    studentA14Pending.approvalStatus = 'rejected';
    await studentA14Pending.save();
    await call(submitStudentId, {
      user: studentA14Pending,
      params: { id: studentA14Approved._id.toString() }, // ignored — no such param is ever read
    });
    const untouchedOther = await User.findById(studentA14Approved._id);
    assert.equal(untouchedOther.approvalStatus, 'approved');
  });
});

describe('Resubmission reappearance — a resubmitted (pending-again) student must be visible to every scope-appropriate reviewer', () => {
  // submitStudentId itself always calls the real (network) uploadStudentIdImage,
  // which these tests deliberately never exercise (same convention as the
  // guard-clause tests above). What actually needs proving here is the
  // reappearance guarantee itself: listPendingStudents is a live query over
  // `approvalStatus: 'pending'` with no persisted "previously rejected, stay
  // hidden" flag anywhere in the schema — so simulating exactly the DB state
  // submitStudentId leaves behind (status back to 'pending', a RESUBMITTED
  // history entry appended, rejectionReason cleared) is a faithful and
  // sufficient test of the guarantee, independent of the upload step.
  async function simulateResubmission(student) {
    // Real resubmission always sets a fresh studentIdImage from the upload —
    // rejectStudent clears it to an empty shape on rejection (see that
    // controller), so a faithful simulation must restore a stand-in image
    // too, or listPendingStudents' own "must have actually submitted
    // something" filter would incorrectly exclude it.
    student.approvalStatus = 'pending';
    student.rejectionReason = '';
    student.studentIdImage = {
      provider: 's3', url: '', key: 'private/student-ids/resubmitted.jpg', bucket: 'test-bucket', size: 12345, mimeType: 'image/jpeg', uploadedAt: new Date(),
    };
    student.approvalHistory.push({ action: 'RESUBMITTED', performedBy: student._id, performedAt: new Date() });
    await student.save();
  }

  test('reappears for Super Admin and Administrator (unrestricted) after having been rejected', async () => {
    await call(rejectStudent, { user: adminUser, params: { id: studentA14Pending._id.toString() } });
    let fresh = await User.findById(studentA14Pending._id);
    assert.equal(fresh.approvalStatus, 'rejected');

    await simulateResubmission(fresh);

    const forSuperAdmin = await call(listPendingStudents, { user: superAdminUser });
    assert.ok(forSuperAdmin.res.body.data.some((s) => String(s._id) === String(studentA14Pending._id)));

    const forAdministrator = await call(listPendingStudents, { user: administratorUser });
    assert.ok(forAdministrator.res.body.data.some((s) => String(s._id) === String(studentA14Pending._id)));
  });

  test('reappears for a matching CR (own department+batch) after rejection + resubmission, and CR can approve it again', async () => {
    await call(rejectStudent, { user: crA14, params: { id: studentA14Pending._id.toString() } });
    const rejected = await User.findById(studentA14Pending._id);
    assert.equal(rejected.approvalStatus, 'rejected');

    await simulateResubmission(rejected);

    const list = await call(listPendingStudents, { user: crA14 });
    assert.ok(list.res.body.data.some((s) => String(s._id) === String(studentA14Pending._id)));

    const approve = await call(approveStudent, { user: crA14, params: { id: studentA14Pending._id.toString() } });
    assert.equal(approve.error, undefined);
    assert.equal(approve.res.body.data.approvalStatus, 'approved');
  });

  test('a non-matching CR still cannot see it after resubmission (scope is re-evaluated, not just "was it ever visible before")', async () => {
    await call(rejectStudent, { user: adminUser, params: { id: studentB14Pending._id.toString() } }); // deptB student, crA14 is deptA
    const rejected = await User.findById(studentB14Pending._id);
    await simulateResubmission(rejected);

    const list = await call(listPendingStudents, { user: crA14 });
    assert.ok(!list.res.body.data.some((s) => String(s._id) === String(studentB14Pending._id)));
  });

  test('reappears for a matching Faculty (assigned department) after rejection + resubmission, and Faculty can approve it again', async () => {
    await call(rejectStudent, { user: facultyDeptA, params: { id: studentA15Pending._id.toString() } });
    const rejected = await User.findById(studentA15Pending._id);
    assert.equal(rejected.approvalStatus, 'rejected');

    await simulateResubmission(rejected);

    const list = await call(listPendingStudents, { user: facultyDeptA });
    assert.ok(list.res.body.data.some((s) => String(s._id) === String(studentA15Pending._id)));

    const approve = await call(approveStudent, { user: facultyDeptA, params: { id: studentA15Pending._id.toString() } });
    assert.equal(approve.error, undefined);
    assert.equal(approve.res.body.data.approvalStatus, 'approved');
  });

  test('a non-matching Faculty still cannot see or act on it after resubmission', async () => {
    await call(rejectStudent, { user: adminUser, params: { id: studentA14Pending._id.toString() } }); // deptA student
    const rejected = await User.findById(studentA14Pending._id);
    await simulateResubmission(rejected);

    // facultyCourseBOnly's scope is deptB/courseInB — deptA student, no matching enrollment
    const list = await call(listPendingStudents, { user: facultyCourseBOnly });
    assert.ok(!list.res.body.data.some((s) => String(s._id) === String(studentA14Pending._id)));

    const attempt = await call(approveStudent, { user: facultyCourseBOnly, params: { id: studentA14Pending._id.toString() } });
    assert.equal(attempt.error?.statusCode, 403);
  });
});
