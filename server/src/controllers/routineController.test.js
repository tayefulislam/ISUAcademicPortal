import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Course from '../models/Course.js';
import Batch from '../models/Batch.js';
import Semester from '../models/Semester.js';
import Settings, { getSettings } from '../models/Settings.js';
import ScheduleInstance from '../models/ScheduleInstance.js';
import AcademicEvent from '../models/AcademicEvent.js';
import Notification from '../models/Notification.js';
import RoutineTemplate from '../models/RoutineTemplate.js';
import {
  getMyRoutine,
  getCurrentNext,
  cancelInstance,
  rescheduleInstance,
} from './routineController.js';

// Controller-level behaviour: what a client can influence, and what it cannot.
//
// The important property is the spec's server-side rule (§32): a student cannot
// widen their own view by putting a different batch/department in the query
// string, because the audience is read from their user record and the query
// parameters are ignored outright.

function fakeRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

async function call(handler, { user, params = {}, query = {}, body = {} } = {}) {
  const req = { user, params, query, body };
  const res = fakeRes();
  let error;
  await handler(req, res, (err) => { error = err; });
  return { res, error };
}

before(async () => {
  await connectTestDb('routine-controller');
});

after(async () => {
  await dropAndDisconnect();
});

let cse;
let eee;
let sem1;
let batch14;
let batch15;
let cse101;
let eee101;
let student;
let otherDeptStudent;
let faculty;

beforeEach(async () => {
  await clearCollections(User, Department, Course, Batch, Semester, Settings, ScheduleInstance, AcademicEvent, Notification, RoutineTemplate);

  cse = await Department.create({ name: 'Computer Science', code: 'CSE' });
  eee = await Department.create({ name: 'Electrical Engineering', code: 'EEE' });
  sem1 = await Semester.create({ name: '1st Semester', code: 'SEM-1' });
  batch14 = await Batch.create({ name: 'BATCH-14', code: 'BATCH-14', department: cse._id });
  batch15 = await Batch.create({ name: 'BATCH-15', code: 'BATCH-15', department: cse._id });
  cse101 = await Course.create({ name: 'Data Structures', courseId: 'CSE-101', department: cse._id });
  eee101 = await Course.create({ name: 'Circuits', courseId: 'EEE-101', department: eee._id });

  faculty = await User.create({ name: 'Rahman', email: 'rahman@test.local', password: 'password123', role: 'faculty' });

  student = await User.create({
    name: 'Student', email: 'student@test.local', password: 'password123',
    role: 'student', department: cse._id, batch: batch14._id, semester: sem1._id,
  });
  otherDeptStudent = await User.create({
    name: 'EEE Student', email: 'eee-student@test.local', password: 'password123',
    role: 'student', department: eee._id, batch: batch14._id, semester: sem1._id,
  });

  const settings = await getSettings();
  settings.routineSystemEnabled = true;
  await settings.save();
});

async function makeInstance(overrides = {}) {
  return ScheduleInstance.create({
    department: cse._id,
    batch: batch14._id,
    semester: sem1._id,
    course: cse101._id,
    group: 'BOTH',
    faculty: faculty._id,
    roomNumber: '501',
    date: '2026-09-20',
    startTime: '10:00',
    endTime: '11:30',
    createdBy: faculty._id,
    ...overrides,
  });
}

describe('GET /routine/my', () => {
  test('returns the caller\'s own schedule with a stable DTO', async () => {
    await makeInstance();
    const { res, error } = await call(getMyRoutine, { user: student });

    assert.equal(error, undefined);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.length, 1);
    const entry = res.body.data[0];
    assert.equal(entry.source, 'ROUTINE');
    assert.equal(entry.eventType, 'CLASS');
    assert.equal(entry.course.code, 'CSE-101');
    assert.equal(entry.faculty.name, 'Rahman');
    assert.equal(entry.room, '501');
    assert.equal(entry.startTime, '10:00');
    assert.equal(entry.mode, 'OFFLINE');
  });

  test('a tampered batch/department in the query string changes nothing', async () => {
    await makeInstance();
    await makeInstance({ batch: batch15._id, startTime: '12:00', endTime: '13:30' });

    const honest = await call(getMyRoutine, { user: student });
    const tampered = await call(getMyRoutine, {
      user: student,
      query: { batch: String(batch15._id), department: String(eee._id), group: 'A2' },
    });

    assert.deepEqual(
      tampered.res.body.data.map((e) => e.id),
      honest.res.body.data.map((e) => e.id),
      'the audience is derived from the user record, never from query parameters'
    );
    assert.equal(tampered.res.body.data.length, 1, 'only their own batch, despite asking for another');
  });

  test('another department\'s entries never appear', async () => {
    await makeInstance({ department: eee._id, course: eee101._id });
    await makeInstance();

    const { res } = await call(getMyRoutine, { user: student });
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].course.code, 'CSE-101');
  });

  test('it refuses while the routine system is switched off', async () => {
    const settings = await getSettings();
    settings.routineSystemEnabled = false;
    await settings.save();

    const { error } = await call(getMyRoutine, { user: student });
    assert.equal(error?.statusCode, 400);
    assert.equal(error?.code, 'ROUTINE_DISABLED');
  });
});

describe('GET /events/my/current-next', () => {
  test('returns serverTime, timezone, current, next and hasAnySchedule', async () => {
    await makeInstance();
    const { res } = await call(getCurrentNext, { user: student });

    assert.equal(res.body.success, true);
    assert.equal(res.body.data.timezone, 'Asia/Dhaka');
    assert.ok(res.body.data.serverTime, 'clients count down from the server clock');
    assert.equal(res.body.data.hasAnySchedule, true);
    assert.ok('current' in res.body.data && 'next' in res.body.data);
  });
});

describe('exceptions on a single occurrence', () => {
  test('cancelling marks that date and tells the students it concerned', async () => {
    const instance = await makeInstance();
    const { res, error } = await call(cancelInstance, { user: faculty, params: { id: String(instance._id) } });

    assert.equal(error, undefined);
    assert.equal(res.body.data.status, 'CANCELLED');

    const stored = await ScheduleInstance.findById(instance._id);
    assert.equal(stored.status, 'CANCELLED');

    const notifications = await Notification.find({ entityId: instance._id });
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].type, 'CLASS_CANCELLED');
    assert.equal(String(notifications[0].recipient), String(student._id));
  });

  test('cancelling twice does not notify twice', async () => {
    const instance = await makeInstance();
    await call(cancelInstance, { user: faculty, params: { id: String(instance._id) } });
    await call(cancelInstance, { user: faculty, params: { id: String(instance._id) } });

    const notifications = await Notification.find({ entityId: instance._id, type: 'CLASS_CANCELLED' });
    assert.equal(notifications.length, 1, 'the unique index makes a repeated cancel a no-op');
  });

  test('rescheduling moves the date and remembers where it came from', async () => {
    const instance = await makeInstance();
    const { res, error } = await call(rescheduleInstance, {
      user: faculty,
      params: { id: String(instance._id) },
      body: { date: '2026-09-22', startTime: '14:00', endTime: '15:30' },
    });

    assert.equal(error, undefined);
    assert.equal(res.body.data.status, 'RESCHEDULED');
    assert.equal(res.body.data.date, '2026-09-22');
    assert.equal(res.body.data.startTime, '14:00');
    assert.ok(res.body.data.originalStartAt, 'the original slot is kept for the audit trail');

    const notified = await Notification.find({ entityId: instance._id, type: 'CLASS_RESCHEDULED' });
    assert.equal(notified.length, 1);
  });

  test('a reschedule without a date and times is rejected', async () => {
    const instance = await makeInstance();
    const { error } = await call(rescheduleInstance, {
      user: faculty,
      params: { id: String(instance._id) },
      body: { date: '2026-09-22' },
    });
    assert.equal(error?.statusCode, 400);
  });

  test('an id that does not exist is a 404, not a crash', async () => {
    const { error } = await call(cancelInstance, { user: faculty, params: { id: '6a9c60e962b5c81cf6100960' } });
    assert.equal(error?.statusCode, 404);
  });
});
