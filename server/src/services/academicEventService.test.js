import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Course from '../models/Course.js';
import Batch from '../models/Batch.js';
import Semester from '../models/Semester.js';
import CourseEnrollment from '../models/CourseEnrollment.js';
import Settings, { getSettings } from '../models/Settings.js';
import ScheduleInstance from '../models/ScheduleInstance.js';
import AcademicEvent from '../models/AcademicEvent.js';
import {
  resolveVisibleEvents,
  getCurrentAndNext,
  audienceFilterFor,
} from './academicEventService.js';

// The audience rules the whole feature hangs on (spec §10, §11, §32):
//  - department + batch + semester + group decide who sees a class
//  - BOTH means the whole batch, so it reaches every group and every group
//    entry reaches a BOTH student
//  - a faculty member sees only their own classes, never a colleague's
//
// Every assertion runs against a real, disposable MongoDB through the same
// service the web client, the Android app and the reminder engine use, so a
// regression here is a regression for all of them at once.

before(async () => {
  await connectTestDb('routine-audience');
});

after(async () => {
  await dropAndDisconnect();
});

let cse;
let eee;
let sem1;
let batch14;
let cse101;
let eee101;
let rahman;
let karim;

/** A fixed anchor so "current"/"next" assertions never depend on the clock. */
const T = (hhmm) => new Date(`2026-09-20T${hhmm}:00+06:00`);

async function makeUser(email, overrides) {
  return User.create({ name: email, email, password: 'password123', ...overrides });
}

async function makeInstance({ group = 'BOTH', faculty = null, startTime = '10:00', endTime = '11:30', course = null, department = null, batch = null, semester = null, date = '2026-09-20' } = {}) {
  return ScheduleInstance.create({
    department: department || cse._id,
    batch: batch || batch14._id,
    semester: semester || sem1._id,
    course: course || cse101._id,
    group,
    faculty,
    roomNumber: '501',
    date,
    startTime,
    endTime,
    createdBy: rahman._id,
  });
}

beforeEach(async () => {
  await clearCollections(User, Department, Course, Batch, Semester, Settings, ScheduleInstance, AcademicEvent);

  cse = await Department.create({ name: 'Computer Science', code: 'CSE' });
  eee = await Department.create({ name: 'Electrical Engineering', code: 'EEE' });
  sem1 = await Semester.create({ name: '1st Semester', code: 'SEM-1' });
  batch14 = await Batch.create({ name: 'BATCH-14', code: 'BATCH-14', department: cse._id });
  cse101 = await Course.create({ name: 'Data Structures', courseId: 'CSE-101', department: cse._id, semester: '1st Semester' });
  eee101 = await Course.create({ name: 'Circuits', courseId: 'EEE-101', department: eee._id, semester: '1st Semester' });

  rahman = await makeUser('rahman@test.local', { role: 'faculty', assignedCourses: [cse101._id] });
  karim = await makeUser('karim@test.local', { role: 'faculty', assignedCourses: [cse101._id] });

  const settings = await getSettings();
  settings.routineSystemEnabled = true;
  await settings.save();
});

describe('routine audience — who sees which class', () => {
  test('group A1 sees A1 and BOTH entries, never A2', async () => {
    const student = await makeUser('a1@test.local', {
      role: 'student', department: cse._id, batch: batch14._id, semester: sem1._id, group: 'A1',
    });

    const a1 = await makeInstance({ group: 'A1', startTime: '10:00', endTime: '11:30' });
    const a2 = await makeInstance({ group: 'A2', startTime: '12:00', endTime: '13:30' });
    const both = await makeInstance({ group: 'BOTH', startTime: '14:00', endTime: '15:30' });

    const visible = await resolveVisibleEvents(student);
    const ids = visible.map((e) => e.id);

    assert.ok(ids.includes(String(a1._id)), 'an A1 class must be visible to an A1 student');
    assert.ok(ids.includes(String(both._id)), 'a BOTH class must be visible to every group');
    assert.ok(!ids.includes(String(a2._id)), 'an A2 class must never be visible to an A1 student');
  });

  test('a BOTH student matches every entry regardless of its group', async () => {
    const student = await makeUser('both@test.local', {
      role: 'student', department: cse._id, batch: batch14._id, semester: sem1._id,
    });
    assert.equal(student.group, 'BOTH', 'the default group is the whole batch');

    await makeInstance({ group: 'A1' });
    await makeInstance({ group: 'A2', startTime: '12:00', endTime: '13:30' });

    const visible = await resolveVisibleEvents(student);
    assert.equal(visible.length, 2);
  });

  test('another department is never visible, even for the same batch and semester', async () => {
    const student = await makeUser('cse-student@test.local', {
      role: 'student', department: cse._id, batch: batch14._id, semester: sem1._id,
    });

    const eeeEntry = await makeInstance({
      department: eee._id, course: eee101._id, batch: batch14._id, semester: sem1._id,
    });
    await makeInstance({});

    const ids = (await resolveVisibleEvents(student)).map((e) => e.id);
    assert.ok(!ids.includes(String(eeeEntry._id)), 'an EEE class must not reach a CSE student');
    assert.equal(ids.length, 1);
  });

  test('a different batch or semester is excluded', async () => {
    const batch15 = await Batch.create({ name: 'BATCH-15', code: 'BATCH-15', department: cse._id });
    const sem2 = await Semester.create({ name: '2nd Semester', code: 'SEM-2' });

    const student = await makeUser('batch14-sem1@test.local', {
      role: 'student', department: cse._id, batch: batch14._id, semester: sem1._id,
    });

    await makeInstance({ batch: batch15._id });
    await makeInstance({ semester: sem2._id, startTime: '12:00', endTime: '13:30' });
    const mine = await makeInstance({ startTime: '14:00', endTime: '15:30' });

    const ids = (await resolveVisibleEvents(student)).map((e) => e.id);
    assert.deepEqual(ids, [String(mine._id)]);
  });

  test('faculty see only their own classes', async () => {
    await makeInstance({ faculty: rahman._id, startTime: '10:00', endTime: '11:30' });
    const karims = await makeInstance({ faculty: karim._id, startTime: '12:00', endTime: '13:30' });

    const rahmans = await resolveVisibleEvents(rahman);
    assert.equal(rahmans.length, 1, "a colleague's class must not appear on the faculty timetable");

    const karimsView = await resolveVisibleEvents(karim);
    assert.deepEqual(karimsView.map((e) => e.id), [String(karims._id)]);
  });

  test('course access does not imply routine visibility for faculty', async () => {
    // Karim is assigned the same course as Rahman but teaches none of the slots.
    await makeInstance({ faculty: rahman._id });
    assert.equal((await resolveVisibleEvents(karim)).length, 0);
  });

  test('an unplaced student sees nothing rather than everything', async () => {
    await makeInstance({});
    const unplaced = await makeUser('unplaced@test.local', { role: 'student' });
    assert.deepEqual(await resolveVisibleEvents(unplaced), []);
  });

  test('an academic event and a class entry resolve through the same audience', async () => {
    const student = await makeUser('exam-taker@test.local', {
      role: 'student', department: cse._id, batch: batch14._id, semester: sem1._id,
    });
    await makeInstance({});

    await AcademicEvent.create({
      department: cse._id, batch: batch14._id, semester: sem1._id, course: cse101._id,
      group: 'BOTH', title: 'CSE 101 CT-1', classType: 'CT',
      date: '2026-10-10', startTime: '10:00', endTime: '11:00', createdBy: rahman._id,
    });

    const visible = await resolveVisibleEvents(student);
    assert.equal(visible.length, 2);
    const exam = visible.find((e) => e.source === 'EVENT');
    assert.equal(exam.eventType, 'EXAM', 'classType CT derives the coarse EXAM type');
    assert.equal(exam.title, 'CSE 101 CT-1');
  });
});

describe('current and next event', () => {
  test('an entry spanning now is current, and the following one is next', async () => {
    const student = await makeUser('live@test.local', {
      role: 'student', department: cse._id, batch: batch14._id, semester: sem1._id,
    });
    await makeInstance({ startTime: '10:00', endTime: '11:30' });
    await makeInstance({ startTime: '12:00', endTime: '13:30' });

    const { current, next, timezone, hasAnySchedule } = await getCurrentAndNext(student, T('10:45'));

    assert.equal(timezone, 'Asia/Dhaka');
    assert.equal(hasAnySchedule, true);
    assert.equal(current.startTime, '10:00');
    assert.equal(current.state, 'IN_PROGRESS');
    assert.equal(next.startTime, '12:00');
    assert.equal(next.state, 'UPCOMING');
  });

  test('a completed class is neither current nor next', async () => {
    const student = await makeUser('after@test.local', {
      role: 'student', department: cse._id, batch: batch14._id, semester: sem1._id,
    });
    await makeInstance({ startTime: '08:00', endTime: '09:30' });
    await makeInstance({ startTime: '12:00', endTime: '13:30' });

    const { current, next } = await getCurrentAndNext(student, T('10:45'));
    assert.equal(current, null);
    assert.equal(next.startTime, '12:00');
  });

  test('a cancelled class is skipped entirely', async () => {
    const student = await makeUser('cancelled@test.local', {
      role: 'student', department: cse._id, batch: batch14._id, semester: sem1._id,
    });
    const cancelled = await makeInstance({ startTime: '10:00', endTime: '11:30' });
    cancelled.status = 'CANCELLED';
    await cancelled.save();
    await makeInstance({ startTime: '12:00', endTime: '13:30' });

    const { current, next } = await getCurrentAndNext(student, T('10:45'));
    assert.equal(current, null, 'a cancelled class must never read as in progress');
    assert.equal(next.startTime, '12:00');
  });

  test('hasAnySchedule distinguishes "free today" from "routine not published"', async () => {
    const student = await makeUser('free@test.local', {
      role: 'student', department: cse._id, batch: batch14._id, semester: sem1._id,
    });

    const empty = await getCurrentAndNext(student, T('10:45'));
    assert.equal(empty.hasAnySchedule, false, 'nothing published at all');

    // A class three weeks out: nothing on today, but the routine exists.
    await makeInstance({ date: '2026-10-11', startTime: '10:00', endTime: '11:30' });
    const later = await getCurrentAndNext(student, T('10:45'));
    assert.equal(later.current, null);
    assert.equal(later.hasAnySchedule, true, 'the routine exists, it is just not today');
  });
});

describe('audience filter', () => {
  test('is derived from the user, and an unplaced account gets an impossible filter', async () => {
    const unplaced = await makeUser('nofilter@test.local', { role: 'student' });
    const filter = await audienceFilterFor(unplaced);
    assert.deepEqual(filter, { _id: null });
  });

  test('faculty are filtered by their own id, not by course scope', async () => {
    const filter = await audienceFilterFor(rahman);
    assert.equal(String(filter.faculty), String(rahman._id));
    assert.equal(filter.department, undefined);
  });
});

// A student enrolled in a course *additionally* (retake/extra/backlog/
// improvement/advance) takes it "out of sync" — the class is scheduled under a
// different batch and semester than their own, which is exactly what a
// department+batch+semester filter would otherwise hide. The enrollment itself
// is the grant, so that class must reach them.
describe('additional-course enrollment — out-of-cohort classes', () => {
  let otherBatch;
  let otherSemester;

  /** An EEE retake class: another department, batch and semester entirely. */
  const outOfCohortClass = (extra = {}) => makeInstance({
    department: eee._id, course: eee101._id, batch: otherBatch._id, semester: otherSemester._id, ...extra,
  });

  const enrol = (student, { type = 'retake', status = 'active' } = {}) => CourseEnrollment.create({
    student: student._id,
    course: eee101._id,
    enrollmentType: type,
    status,
    academicYear: '2026',
    semester: otherSemester._id,
    batch: otherBatch._id,
  });

  const enrolledStudent = (email, overrides = {}) => makeUser(email, {
    role: 'student', department: cse._id, batch: batch14._id, semester: sem1._id, ...overrides,
  });

  beforeEach(async () => {
    otherBatch = await Batch.create({ name: 'BATCH-13', code: 'BATCH-13', department: eee._id });
    otherSemester = await Semester.create({ name: '3rd Semester', code: 'SEM-3' });
  });

  test('the enrolled course’s class appears alongside the student’s own cohort', async () => {
    const student = await enrolledStudent('retake@test.local');
    await enrol(student);

    const extra = await outOfCohortClass();
    const own = await makeInstance({ startTime: '12:00', endTime: '13:30' });

    const ids = (await resolveVisibleEvents(student)).map((e) => e.id);
    assert.ok(ids.includes(String(extra._id)), 'the enrolled course class must be visible');
    assert.ok(ids.includes(String(own._id)), 'the student’s own cohort visibility is unchanged');
  });

  test('without any enrollment that class stays invisible (no widening)', async () => {
    const student = await enrolledStudent('plain@test.local');
    const extra = await outOfCohortClass();
    await makeInstance({});

    const ids = (await resolveVisibleEvents(student)).map((e) => e.id);
    assert.ok(!ids.includes(String(extra._id)));
  });

  test('a pending or rejected enrollment grants nothing', async () => {
    const pending = await enrolledStudent('pending-enrol@test.local');
    await enrol(pending, { status: 'pending' });
    const extra = await outOfCohortClass();

    const ids = (await resolveVisibleEvents(pending)).map((e) => e.id);
    assert.ok(!ids.includes(String(extra._id)), 'only active/approved enrollments grant the class');
  });

  test('a stored regular enrollment does not reopen the cohort axes', async () => {
    const student = await enrolledStudent('regular-enrol@test.local');
    await enrol(student, { type: 'regular' });
    const extra = await outOfCohortClass();

    const ids = (await resolveVisibleEvents(student)).map((e) => e.id);
    assert.ok(!ids.includes(String(extra._id)), 'a regular enrollment is housekeeping, not a cohort override');
  });

  test('the group axis still applies to the additional course', async () => {
    const student = await enrolledStudent('grouped@test.local', { group: 'A1' });
    await enrol(student);

    const a2 = await outOfCohortClass({ group: 'A2' });
    const a1 = await outOfCohortClass({ group: 'A1', startTime: '12:00', endTime: '13:30' });

    const ids = (await resolveVisibleEvents(student)).map((e) => e.id);
    assert.ok(ids.includes(String(a1._id)), 'the student’s own group of the enrolled course is visible');
    assert.ok(!ids.includes(String(a2._id)), 'another group of it is not');
  });

  test('a department course in another semester is still excluded (no over-widening)', async () => {
    const student = await enrolledStudent('dept-other-sem@test.local');
    // CSE-101 belongs to the student's own department, but nothing enrols them
    // in it additionally — so the cohort axes must keep hiding this class.
    const otherSemClass = await makeInstance({ semester: otherSemester._id });
    await makeInstance({ startTime: '12:00', endTime: '13:30' });

    const ids = (await resolveVisibleEvents(student)).map((e) => e.id);
    assert.ok(!ids.includes(String(otherSemClass._id)));
  });
});
