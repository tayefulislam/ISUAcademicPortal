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
  listInstances,
  cancelInstance,
  rescheduleInstance,
  updateTemplate,
  updateInstance,
} from './routineController.js';
import { generateInstancesForTemplate } from '../services/routineService.js';

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

describe('GET /routine/instances — the manager timetable', () => {
  test('returns one Dhaka day, narrowed by the audience axes', async () => {
    const admin = await User.create({
      name: 'Admin', email: 'admin@test.local', password: 'password123', role: 'admin',
    });
    await makeInstance({ startTime: '10:00', endTime: '11:30' });
    await makeInstance({ date: '2026-09-21', startTime: '10:00', endTime: '11:30' });
    await makeInstance({ batch: batch15._id, startTime: '12:00', endTime: '13:30' });

    const { res, error } = await call(listInstances, {
      user: admin,
      query: { date: '2026-09-20', batch: String(batch14._id) },
    });

    assert.equal(error, undefined);
    assert.equal(res.body.data.length, 1, 'one date, one batch');
    assert.equal(res.body.data[0].date, '2026-09-20');
  });

  test('a faculty member sees only their assigned courses', async () => {
    const scoped = await User.create({
      name: 'Scoped', email: 'scoped@test.local', password: 'password123',
      role: 'faculty', assignedCourses: [cse101._id],
    });
    const elsewhere = await User.create({
      name: 'Elsewhere', email: 'elsewhere@test.local', password: 'password123',
      role: 'faculty', assignedCourses: [eee101._id],
    });
    await makeInstance();

    const mine = await call(listInstances, { user: scoped, query: { date: '2026-09-20' } });
    assert.equal(mine.res.body.data.length, 1);

    const theirs = await call(listInstances, { user: elsewhere, query: { date: '2026-09-20' } });
    assert.equal(theirs.res.body.data.length, 0, 'another course\'s timetable is not theirs to manage');
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

  test('cancelling clears the reminders that counted down to it', async () => {
    const instance = await makeInstance();
    // A reminder the cron already created for this class. Cancelling makes it a
    // lie, so the write has to remove it rather than leave it in the list forever.
    await Notification.create({
      recipient: student._id, type: 'CLASS_REMINDER', title: 'Class Reminder',
      message: 'CSE-101 starts in 30 minutes', entityType: 'ScheduleInstance',
      entityId: instance._id, slot: '30@2026-09-20T04:00:00.000Z',
    });

    await call(cancelInstance, { user: faculty, params: { id: String(instance._id) } });

    assert.equal(
      await Notification.countDocuments({ entityId: instance._id, type: 'CLASS_REMINDER' }), 0,
      'a cancelled class keeps no reminder'
    );
    assert.equal(
      await Notification.countDocuments({ entityId: instance._id, type: 'CLASS_CANCELLED' }), 1,
      'but the cancellation notice itself is kept'
    );
  });

  test('editing the time through PATCH notifies, as /reschedule already did', async () => {
    const instance = await makeInstance();
    const { error } = await call(updateInstance, {
      user: faculty,
      params: { id: String(instance._id) },
      body: { startTime: '14:00', endTime: '15:30' },
    });

    assert.equal(error, undefined);
    const notified = await Notification.find({ entityId: instance._id, type: 'CLASS_RESCHEDULED' });
    assert.equal(notified.length, 1, 'a PATCH that moves the class must tell the students');
  });

  test('changing the room twice notifies twice — the slot follows the new value', async () => {
    const instance = await makeInstance();
    await call(updateInstance, {
      user: faculty, params: { id: String(instance._id) }, body: { roomNumber: '603' },
    });
    await call(updateInstance, {
      user: faculty, params: { id: String(instance._id) }, body: { roomNumber: '701' },
    });

    const notified = await Notification.find({ entityId: instance._id, type: 'CLASS_ROOM_CHANGED' });
    assert.equal(notified.length, 2, 'a second move must not be swallowed by the first');
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

// The whole point of the master/occurrence model: one administrator edit updates
// every dependent date, and a date that was changed individually keeps its own
// value through that edit.
describe('routine edits propagate to their occurrences', () => {
  /** A rule covering every day of a short, far-off range, so no assertion depends on the wall clock. */
  async function makeDailyTemplate({ startDate = '2035-01-01', endDate = '2035-01-05' } = {}) {
    const template = await RoutineTemplate.create({
      department: cse._id, batch: batch14._id, semester: sem1._id, course: cse101._id,
      group: 'BOTH', faculty: faculty._id, roomNumber: '501',
      days: [0, 1, 2, 3, 4, 5, 6], startDate, endDate,
      startTime: '10:00', endTime: '11:30', createdBy: faculty._id,
    });
    await generateInstancesForTemplate(template, faculty._id);
    return template;
  }

  test('one routine edit brings every date into line', async () => {
    const template = await makeDailyTemplate();

    const { res, error } = await call(updateTemplate, {
      user: faculty,
      params: { id: String(template._id) },
      body: { startTime: '14:00', endTime: '15:30', roomNumber: '777', applyFrom: 'entire' },
    });

    assert.equal(error, undefined);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.synced.updated, 5);

    const rows = await ScheduleInstance.find({ template: template._id });
    assert.equal(rows.length, 5);
    assert.ok(rows.every((row) => row.startTime === '14:00' && row.roomNumber === '777'));
  });

  test('a date changed individually keeps its value through a routine edit', async () => {
    const template = await makeDailyTemplate();
    const target = await ScheduleInstance.findOne({ template: template._id, date: '2035-01-03' });

    await call(updateInstance, { user: faculty, params: { id: String(target._id) }, body: { roomNumber: '603' } });
    const edited = await ScheduleInstance.findById(target._id);
    assert.deepEqual(edited.overriddenFields, ['roomNumber'], 'the edit is recorded as this date\'s own value');

    await call(updateTemplate, {
      user: faculty,
      params: { id: String(template._id) },
      body: { roomNumber: '777', startTime: '14:00', endTime: '15:30', applyFrom: 'entire' },
    });

    const after = await ScheduleInstance.findById(target._id);
    assert.equal(after.roomNumber, '603', 'the override wins over the routine');
    assert.equal(after.startTime, '14:00', 'the field it did not touch still follows the routine');
  });

  test('resetFields hands a date back to the routine', async () => {
    const template = await makeDailyTemplate();
    const target = await ScheduleInstance.findOne({ template: template._id, date: '2035-01-02' });

    await call(updateInstance, { user: faculty, params: { id: String(target._id) }, body: { roomNumber: '603' } });
    await call(updateInstance, { user: faculty, params: { id: String(target._id) }, body: { resetFields: ['roomNumber'] } });

    const after = await ScheduleInstance.findById(target._id);
    assert.deepEqual(after.overriddenFields, []);
    assert.equal(after.roomNumber, '501', 'back to the routine value straight away');
  });

  test('rescheduling one date records the move as that date\'s own times', async () => {
    const template = await makeDailyTemplate();
    const target = await ScheduleInstance.findOne({ template: template._id, date: '2035-01-04' });

    await call(rescheduleInstance, {
      user: faculty,
      params: { id: String(target._id) },
      body: { date: '2035-01-06', startTime: '16:00', endTime: '17:30' },
    });

    const after = await ScheduleInstance.findById(target._id);
    assert.equal(after.status, 'RESCHEDULED');
    assert.ok(after.overriddenFields.includes('startTime'));
    assert.ok(after.overriddenFields.includes('endTime'));

    // A later routine edit must not pull the moved class back to the rule.
    await call(updateTemplate, {
      user: faculty,
      params: { id: String(template._id) },
      body: { startTime: '09:00', endTime: '10:30', applyFrom: 'entire' },
    });
    const stillMoved = await ScheduleInstance.findById(target._id);
    assert.equal(stillMoved.startTime, '16:00');
  });

  test('completed dates are only rewritten when the caller asks for it', async () => {
    const template = await makeDailyTemplate({ startDate: '2020-01-01', endDate: '2020-01-05' });

    await call(updateTemplate, {
      user: faculty,
      params: { id: String(template._id) },
      body: { startTime: '14:00', endTime: '15:30' },
    });
    let rows = await ScheduleInstance.find({ template: template._id });
    assert.ok(rows.every((row) => row.startTime === '10:00'), 'history is untouched by the default scope');

    await call(updateTemplate, {
      user: faculty,
      params: { id: String(template._id) },
      body: { startTime: '16:00', endTime: '17:30', applyFrom: 'entire' },
    });
    rows = await ScheduleInstance.find({ template: template._id });
    assert.ok(rows.every((row) => row.startTime === '16:00'), 'entire reaches back into history');
  });

  test('an unknown applyFrom is rejected', async () => {
    const template = await makeDailyTemplate();
    const { error } = await call(updateTemplate, {
      user: faculty,
      params: { id: String(template._id) },
      body: { applyFrom: 'someday' },
    });
    assert.equal(error?.statusCode, 400);
  });
});
