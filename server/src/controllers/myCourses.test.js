import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Course from '../models/Course.js';
import Batch from '../models/Batch.js';
import Semester from '../models/Semester.js';
import Category from '../models/Category.js';
import File from '../models/File.js';
import Assignment from '../models/Assignment.js';
import Quiz from '../models/Quiz.js';
import CourseEnrollment from '../models/CourseEnrollment.js';
import FacultyCourse from '../models/FacultyCourse.js';
import { getSettings } from '../models/Settings.js';
import { getFacultyCourses, setCourseTeachingStatus } from './facultyController.js';
import { getMyCourses, getCourseBatches } from './courseController.js';
import { getFacultyScopedFiles } from './fileController.js';
import { createAssignment, listRelevantAssignments } from './assignmentController.js';
import { listRelevantQuizzes } from './quizController.js';

// My Courses for three roles. The rules that matter here:
//  - a course is "active" for one faculty member only, and starts deactivated
//  - the batch selector is derived from the data, never hardcoded
//  - a student's Running Courses are their own department's courses for their
//    own semester; retake/improvement appear only when they exist
//  - batch targeting is enforced by the server, not by the client's filtering

before(async () => {
  await connectTestDb('my-courses');
});

after(async () => {
  await dropAndDisconnect();
});

let cse, eee, sem3, sem5, cse101, cse102, cse201, eee101;
let facultyDirect, facultyDept, student14, student13;

function fakeRes() {
  return {
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
}

async function invoke(handler, req) {
  const res = fakeRes();
  let failure = null;
  await handler(req, res, (err) => {
    failure = err;
  });
  if (failure) throw failure;
  return res.body;
}

async function statusOf(handler, req) {
  try {
    await invoke(handler, req);
    return null;
  } catch (err) {
    return err.statusCode;
  }
}

beforeEach(async () => {
  await clearCollections(
    User, Department, Course, Batch, Semester, Category,
    File, Assignment, Quiz, CourseEnrollment, FacultyCourse
  );

  cse = await Department.create({ name: 'Computer Science', code: 'CSE' });
  eee = await Department.create({ name: 'Electrical Engineering', code: 'EEE' });

  sem3 = await Semester.create({ name: '3rd Semester', code: 'SEM-3' });
  sem5 = await Semester.create({ name: '5th Semester', code: 'SEM-5' });

  // Course.semester is a free-text label; it is the only link between a course
  // and a semester in this data model, so Running Courses matches on it.
  cse101 = await Course.create({ name: 'Intro to Programming', courseId: 'CSE-101', department: cse._id, semester: '3rd Semester' });
  cse102 = await Course.create({ name: 'Data Structures', courseId: 'CSE-102', department: cse._id, semester: '3rd Semester' });
  cse201 = await Course.create({ name: 'Algorithms', courseId: 'CSE-201', department: cse._id, semester: '5th Semester' });
  eee101 = await Course.create({ name: 'Circuits', courseId: 'EEE-101', department: eee._id, semester: '3rd Semester' });

  // Ten batches so the "last 8" cap is actually exercised.
  for (let n = 1; n <= 10; n += 1) {
    const padded = String(n).padStart(2, '0');
    await Batch.create({
      name: `BATCH-${padded}`,
      code: `BATCH-${padded}`,
      department: cse._id,
      year: 2000 + n,
    });
  }
  // A batch in another department, used by the "batch must belong to the
  // course's department" test.
  await Batch.create({ name: 'BATCH-01', code: 'EEE-BATCH-01', department: eee._id });

  const mkUser = (email, overrides) =>
    User.create({ name: 'U', email, password: 'password123', ...overrides });

  facultyDirect = await mkUser('fac-direct@test.local', {
    role: 'faculty',
    assignedCourses: [cse101._id],
    assignedDepartments: [],
  });
  facultyDept = await mkUser('fac-dept@test.local', {
    role: 'faculty',
    assignedCourses: [],
    assignedDepartments: [cse._id],
  });

  const batch14 = await Batch.findOne({ name: 'BATCH-14' }) || await Batch.findOne({ code: 'BATCH-10' });
  const batch13 = await Batch.findOne({ code: 'BATCH-09' });

  student14 = await mkUser('s14@test.local', {
    role: 'student',
    department: cse._id,
    batch: batch14._id,
    semester: sem3._id,
  });
  student13 = await mkUser('s13@test.local', {
    role: 'student',
    department: cse._id,
    batch: batch13._id,
    semester: sem3._id,
  });

  // The assignment and quiz systems ship disabled; the audience listings and
  // the create paths both refuse to run until an admin turns them on.
  const settings = await getSettings();
  settings.assignmentSystemEnabled = true;
  settings.quizSystemEnabled = true;
  await settings.save();
});

describe('faculty My Courses — activation', () => {
  test('every course starts deactivated, and is listed for the faculty member', async () => {
    const body = await invoke(getFacultyCourses, { user: facultyDept, query: {} });

    const codes = body.data.map((c) => c.courseId).sort();
    assert.deepEqual(codes, ['CSE-101', 'CSE-102', 'CSE-201']);
    assert.ok(body.data.every((c) => c.teachingStatus === 'deactivated'));
  });

  test('accepts a course assigned directly AND a course in an assigned department', async () => {
    const direct = await invoke(getFacultyCourses, { user: facultyDirect, query: {} });
    assert.deepEqual(direct.data.map((c) => c.courseId), ['CSE-101']);

    const dept = await invoke(getFacultyCourses, { user: facultyDept, query: {} });
    assert.equal(dept.data.length, 3);
  });

  test('activating moves a course into Active Classes, deactivating moves it back', async () => {
    await invoke(setCourseTeachingStatus, {
      user: facultyDept,
      params: { courseId: String(cse101._id) },
      body: { status: 'active' },
    });

    const active = await invoke(getFacultyCourses, { user: facultyDept, query: { status: 'active' } });
    assert.deepEqual(active.data.map((c) => c.courseId), ['CSE-101']);

    await invoke(setCourseTeachingStatus, {
      user: facultyDept,
      params: { courseId: String(cse101._id) },
      body: { status: 'deactivated' },
    });

    const backAgain = await invoke(getFacultyCourses, { user: facultyDept, query: { status: 'deactivated' } });
    assert.equal(backAgain.data.length, 3);
  });

  test('activation is per-faculty — it does not change what another faculty member sees', async () => {
    await invoke(setCourseTeachingStatus, {
      user: facultyDirect,
      params: { courseId: String(cse101._id) },
      body: { status: 'active' },
    });

    const otherFaculty = await invoke(getFacultyCourses, { user: facultyDept, query: { status: 'active' } });
    assert.equal(otherFaculty.data.length, 0, 'the other faculty member still sees nothing active');
  });

  test('deactivating never touches the course or its content', async () => {
    await Category.create({ name: 'Lecture Notes', slug: 'lecture-notes' });

    await invoke(setCourseTeachingStatus, {
      user: facultyDept,
      params: { courseId: String(cse101._id) },
      body: { status: 'active' },
    });
    await invoke(setCourseTeachingStatus, {
      user: facultyDept,
      params: { courseId: String(cse101._id) },
      body: { status: 'deactivated' },
    });

    assert.ok(await Course.findById(cse101._id), 'the course still exists');
  });

  test('refuses to change a course the faculty member is not assigned to', async () => {
    assert.equal(
      await statusOf(setCourseTeachingStatus, {
        user: facultyDirect,
        params: { courseId: String(eee101._id) },
        body: { status: 'active' },
      }),
      403
    );
  });

  test('rejects an unknown status value', async () => {
    assert.equal(
      await statusOf(setCourseTeachingStatus, {
        user: facultyDept,
        params: { courseId: String(cse101._id) },
        body: { status: 'whatever' },
      }),
      400
    );
  });

  test('?counts=true adds content counts per course', async () => {
    const body = await invoke(getFacultyCourses, { user: facultyDept, query: { counts: 'true' } });
    const course = body.data.find((c) => c.courseId === 'CSE-101');
    assert.deepEqual(course.counts, { files: 0, assignments: 0, quizzes: 0 });
  });
});

describe('batch selector', () => {
  test('offers only the most recent 8 batches, newest first', async () => {
    const body = await invoke(getCourseBatches, {
      user: student14,
      params: { courseId: String(cse101._id) },
      query: {},
    });

    assert.equal(body.data.length, 8);
    assert.deepEqual(
      body.data.map((b) => b.code),
      ['BATCH-10', 'BATCH-09', 'BATCH-08', 'BATCH-07', 'BATCH-06', 'BATCH-05', 'BATCH-04', 'BATCH-03']
    );
  });

  test('a newly created batch displaces the oldest — nothing is hardcoded', async () => {
    await Batch.create({ name: 'BATCH-11', code: 'BATCH-11', department: cse._id, year: 2011 });

    const body = await invoke(getCourseBatches, {
      user: student14,
      params: { courseId: String(cse101._id) },
      query: {},
    });

    assert.equal(body.data[0].code, 'BATCH-11');
    assert.equal(body.data.length, 8);
    assert.ok(!body.data.some((b) => b.code === 'BATCH-03'), 'the oldest fell out of the window');
  });

  test('reports per-batch content counts for the course', async () => {
    const batch = await Batch.findOne({ code: 'BATCH-10' });
    const category = await Category.create({ name: 'Lecture Notes', slug: 'lecture-notes' });

    await File.create({
      title: 'Lecture 01',
      originalName: 'lecture-01.pdf',
      fileName: 'lecture-01.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      fileSize: 1024,
      fileUrl: 'https://example.test/f.pdf',
      storageProvider: 'local',
      department: cse._id,
      departmentCode: 'CSE',
      course: cse101._id,
      courseName: cse101.name,
      courseId: cse101.courseId,
      category: category._id,
      categoryName: category.name,
      uploadedBy: facultyDept._id,
      batches: [batch._id],
      batchCodes: [batch.code],
      attachments: [
        {
          originalName: 'lecture-01.pdf', fileName: 'lecture-01.pdf', fileType: 'pdf',
          mimeType: 'application/pdf', fileSize: 1024, fileUrl: 'https://example.test/f.pdf',
          storageProvider: 'local',
        },
      ],
    });

    const body = await invoke(getCourseBatches, {
      user: facultyDept,
      params: { courseId: String(cse101._id) },
      query: {},
    });

    const target = body.data.find((b) => b.code === 'BATCH-10');
    assert.equal(target.counts.files, 1);
  });
});

describe('student My Courses — running and other', () => {
  test('running courses are the department courses for the student\'s own semester', async () => {
    const body = await invoke(getMyCourses, { user: student14, query: { grouped: 'true' } });

    assert.deepEqual(
      body.data.running.map((c) => c.courseId).sort(),
      ['CSE-101', 'CSE-102'],
      'CSE-201 is a 5th-semester course and must not appear'
    );
    assert.deepEqual(body.data.other, []);
  });

  test('a retake enrolment appears under Other when it exists, and only then', async () => {
    await CourseEnrollment.create({
      student: student14._id,
      course: eee101._id,
      enrollmentType: 'retake',
      status: 'active',
      academicYear: '2025-2026',
      semester: sem3._id,
    });

    const body = await invoke(getMyCourses, { user: student14, query: { grouped: 'true' } });
    assert.equal(body.data.other.length, 1);
    assert.equal(body.data.other[0].enrollmentType, 'retake');
    assert.equal(body.data.other[0].course.courseId, 'EEE-101');
  });

  test('a regular enrolment is not listed under Other (it is a running course)', async () => {
    await CourseEnrollment.create({
      student: student14._id,
      course: cse101._id,
      enrollmentType: 'regular',
      status: 'active',
      academicYear: '2025-2026',
      semester: sem3._id,
    });

    const body = await invoke(getMyCourses, { user: student14, query: { grouped: 'true' } });
    assert.deepEqual(body.data.other, []);
  });

  test('without grouped=true the response keeps its original flat shape', async () => {
    const body = await invoke(getMyCourses, { user: student14, query: {} });
    assert.ok(Array.isArray(body.data));
    assert.equal(body.data.length, 3, 'department courses only, as before');
  });
});

describe('faculty content isolation — access is not ownership', () => {
  // Two faculty members both teach CSE-101. Activating it, or being assigned
  // the course, must never expose one's material to the other: the filter is
  // pinned to the authenticated user, not to the course.
  async function uploadAs(uploader, title) {
    const category = await Category.findOne({ slug: 'notes' })
      || await Category.create({ name: 'Notes', slug: 'notes' });

    return File.create({
      title,
      originalName: 'notes.pdf',
      fileName: `${title}.pdf`,
      fileType: 'pdf',
      mimeType: 'application/pdf',
      fileSize: 1024,
      fileUrl: 'https://example.test/notes.pdf',
      storageProvider: 'local',
      department: cse._id,
      departmentCode: 'CSE',
      course: cse101._id,
      courseName: cse101.name,
      courseId: cse101.courseId,
      category: category._id,
      categoryName: category.name,
      uploadedBy: uploader._id,
      approvalStatus: 'approved',
      attachments: [
        {
          originalName: 'notes.pdf',
          fileName: 'notes.pdf',
          fileType: 'pdf',
          mimeType: 'application/pdf',
          fileSize: 1024,
          fileUrl: 'https://example.test/notes.pdf',
          storageProvider: 'local',
        },
      ],
    });
  }

  test("a faculty file list holds only the caller's own uploads", async () => {
    await uploadAs(facultyDept, 'Own material');
    await uploadAs(facultyDirect, 'Colleague material');

    const body = await invoke(getFacultyScopedFiles, { user: facultyDept, query: {} });

    assert.equal(body.data.length, 1, "a colleague's upload must not be listed");
    assert.equal(String(body.data[0].uploadedBy), String(facultyDept._id));
    assert.equal(body.data[0].title, 'Own material');
  });

  test('a colleague uploading cannot widen the scope, and the owner still sees theirs', async () => {
    await uploadAs(facultyDept, 'Own material');
    await uploadAs(facultyDirect, 'Colleague material');

    const theirs = await invoke(getFacultyScopedFiles, { user: facultyDirect, query: {} });
    assert.equal(theirs.data.length, 1);
    assert.equal(theirs.data[0].title, 'Colleague material');
  });

  test("the counts on a My Courses card are the caller's own", async () => {
    await uploadAs(facultyDept, 'Own material');
    await uploadAs(facultyDirect, 'Colleague material');
    await uploadAs(facultyDirect, 'Colleague material two');

    const body = await invoke(getFacultyCourses, { user: facultyDept, query: { counts: 'true' } });
    const course = body.data.find((c) => String(c._id) === String(cse101._id));

    assert.equal(course.counts.files, 1, "the card must not count a colleague's material");
  });

  test('activating a course for one faculty does not change what the other sees', async () => {
    await uploadAs(facultyDirect, 'Colleague material');
    await invoke(setCourseTeachingStatus, {
      user: facultyDept,
      params: { courseId: String(cse101._id) },
      body: { status: 'active' },
    });

    const body = await invoke(getFacultyScopedFiles, { user: facultyDept, query: {} });
    assert.equal(body.data.length, 0, 'activation grants no access to anyone else\'s content');
  });
});

describe('batch isolation is enforced server-side', () => {
  async function seedAssignmentFor(batchId) {
    return Assignment.create({
      title: 'Batch-specific task',
      description: 'Only for one batch',
      departments: [],
      courses: [cse101._id],
      batches: [batchId],
      semesters: [],
      deadline: new Date(Date.now() + 86400000),
      maxMarks: 10,
      submissionType: 'text',
      status: 'published',
      createdBy: facultyDept._id,
    });
  }

  test('a student outside the targeted batch does not receive the assignment', async () => {
    const b10 = await Batch.findOne({ code: 'BATCH-10' });
    await seedAssignmentFor(b10._id);

    const mine = await invoke(listRelevantAssignments, { user: student14, query: {} });
    const theirs = await invoke(listRelevantAssignments, { user: student13, query: {} });

    const sawIt = (body) => body.data.some((a) => a.title === 'Batch-specific task');
    assert.equal(sawIt(mine), true, 'BATCH-10 is student14\'s batch');
    assert.equal(sawIt(theirs), false, 'student13 is in another batch and must not see it');
  });

  test('a student in the targeted batch does receive it', async () => {
    const ownBatch = student14.batch;
    await seedAssignmentFor(ownBatch);

    const mine = await invoke(listRelevantAssignments, { user: student14, query: {} });
    assert.ok(mine.data.some((a) => a.title === 'Batch-specific task'));
  });

  test('a course filter on the audience list can only narrow, never widen', async () => {
    const ownBatch = student14.batch;
    await seedAssignmentFor(ownBatch);

    // A course the student has no access to yields nothing, even though the
    // assignment exists and is targeted at their batch.
    const foreign = await invoke(listRelevantAssignments, {
      user: student14,
      query: { course: String(eee101._id) },
    });
    assert.equal(foreign.data.length, 0);

    const own = await invoke(listRelevantAssignments, {
      user: student14,
      query: { course: String(cse101._id) },
    });
    assert.equal(own.data.length, 1);
  });

  test('quizzes follow the same batch rule', async () => {
    const b10 = await Batch.findOne({ code: 'BATCH-10' });
    await Quiz.create({
      title: 'Batch quiz',
      courses: [cse101._id],
      batches: [b10._id],
      startAt: new Date(Date.now() - 3600000),
      endAt: new Date(Date.now() + 3600000),
      duration: 30,
      status: 'published',
      questions: [],
      createdBy: facultyDept._id,
    });

    const mine = await invoke(listRelevantQuizzes, { user: student14, query: {} });
    const theirs = await invoke(listRelevantQuizzes, { user: student13, query: {} });
    const sawIt = (body) => body.data.some((q) => q.title === 'Batch quiz');
    assert.notEqual(sawIt(mine), sawIt(theirs));
  });
});

describe('content creation', () => {
  test('a department-assigned faculty member can create an assignment for a course in that department', async () => {
    // Previously this 403'd: the write path only accepted `assignedCourses`
    // while the course list (correctly) also offered department-assigned courses.
    const body = await invoke(createAssignment, {
      user: facultyDept,
      body: {
        title: 'Week 1',
        description: 'Read chapter 1',
        deadline: new Date(Date.now() + 86400000).toISOString(),
        maxMarks: '10',
        courses: [String(cse101._id)],
      },
      files: [],
    });

    assert.equal(body.success, true);
  });

  test('refuses a batch that does not belong to the course\'s department', async () => {
    const eeeBatch = await Batch.findOne({ code: 'EEE-BATCH-01' });

    assert.equal(
      await statusOf(createAssignment, {
        user: facultyDept,
        body: {
          title: 'Bad batch',
          description: 'x',
          deadline: new Date(Date.now() + 86400000).toISOString(),
          maxMarks: '10',
          courses: [String(cse101._id)],
          batches: [String(eeeBatch._id)],
        },
        files: [],
      }),
      400
    );
  });

  test('accepts a batch from the course\'s own department', async () => {
    const b10 = await Batch.findOne({ code: 'BATCH-10' });

    const body = await invoke(createAssignment, {
      user: facultyDept,
      body: {
        title: 'Week 1',
        description: 'Read chapter 1',
        deadline: new Date(Date.now() + 86400000).toISOString(),
        maxMarks: '10',
        courses: [String(cse101._id)],
        batches: [String(b10._id)],
      },
      files: [],
    });

    assert.equal(String(body.data.batches[0]), String(b10._id));
  });

  test('a faculty member cannot create content for a course they are not assigned to', async () => {
    assert.equal(
      await statusOf(createAssignment, {
        user: facultyDirect,
        body: {
          title: 'Not mine',
          description: 'x',
          deadline: new Date(Date.now() + 86400000).toISOString(),
          maxMarks: '10',
          courses: [String(eee101._id)],
        },
        files: [],
      }),
      403
    );
  });
});
