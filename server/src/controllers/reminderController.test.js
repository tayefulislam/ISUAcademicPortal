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
import { env } from '../config/env.js';
import { runDueReminders, runExamReminders } from '../services/reminderService.js';
import { runReminders } from './reminderController.js';

// The reminder engine, driven the way the cron drives it: as a function of
// "now" rather than a timer.
//
// The two properties that matter most:
//  - idempotency — running the endpoint twice must not double-notify (spec §48)
//  - authorisation — the endpoint is a machine target, so it must refuse to run
//    at all unless the shared secret is configured AND matches.

function fakeRes() {
  const res = { statusCode: 200 };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}
function fakeReq(headers = {}) {
  return { get: (name) => headers[String(name).toLowerCase()], ip: '127.0.0.1' };
}

async function callController(req) {
  const res = fakeRes();
  let error;
  await runReminders(req, res, (err) => { error = err; });
  return { res, error };
}

before(async () => {
  await connectTestDb('routine-reminders');
});

after(async () => {
  await dropAndDisconnect();
  delete env.reminderCronSecret;
});

let cse;
let sem1;
let batch14;
let cse101;
let faculty;
let student;

beforeEach(async () => {
  await clearCollections(User, Department, Course, Batch, Semester, Settings, ScheduleInstance, AcademicEvent, Notification);

  cse = await Department.create({ name: 'Computer Science', code: 'CSE' });
  sem1 = await Semester.create({ name: '1st Semester', code: 'SEM-1' });
  batch14 = await Batch.create({ name: 'BATCH-14', code: 'BATCH-14', department: cse._id });
  cse101 = await Course.create({ name: 'Data Structures', courseId: 'CSE-101', department: cse._id });

  faculty = await User.create({ name: 'Rahman', email: 'rahman@test.local', password: 'password123', role: 'faculty' });
  student = await User.create({
    name: 'Student', email: 'student@test.local', password: 'password123',
    role: 'student', department: cse._id, batch: batch14._id, semester: sem1._id,
  });

  const settings = await getSettings();
  settings.routineSystemEnabled = true;
  await settings.save();

  env.reminderCronSecret = 'test-secret-value';
});

/** A class starting at `hhmm` Dhaka time on the anchor date. */
async function makeInstance({ date = '2026-09-20', startTime = '10:00', endTime = '11:30', status = 'NORMAL' } = {}) {
  const instance = await ScheduleInstance.create({
    department: cse._id, batch: batch14._id, semester: sem1._id, course: cse101._id,
    group: 'BOTH', faculty: faculty._id, roomNumber: '501',
    date, startTime, endTime, createdBy: faculty._id,
  });
  if (status !== 'NORMAL') {
    instance.status = status;
    await instance.save();
  }
  return instance;
}

describe('reminder authorisation', () => {
  test('refuses to run while no secret is configured', async () => {
    env.reminderCronSecret = '';
    const { error } = await callController(fakeReq());
    assert.equal(error?.statusCode, 503, 'an unconfigured endpoint must not be open');
  });

  test('rejects a wrong or missing secret', async () => {
    const missing = await callController(fakeReq());
    assert.equal(missing.error?.statusCode, 401);

    const wrong = await callController(fakeReq({ 'x-reminder-secret': 'not-the-secret' }));
    assert.equal(wrong.error?.statusCode, 401);
  });

  test('runs with the right secret', async () => {
    const { res, error } = await callController(fakeReq({ 'x-reminder-secret': env.reminderCronSecret }));
    assert.equal(error, undefined);
    assert.equal(res.body.success, true);
    assert.ok(res.body.data.classReminders, 'the summary reports what each offset matched');
  });
});

describe('reminder offsets', () => {
  test('the 30-minute reminder fires inside its window', async () => {
    await makeInstance({ startTime: '10:30' });
    const now = new Date('2026-09-20T10:00:00+06:00');

    const summary = await runDueReminders(now);
    const reminder = await Notification.findOne({ type: 'CLASS_REMINDER' });

    assert.ok(reminder, 'a class 30 minutes out must remind');
    assert.equal(String(reminder.recipient), String(student._id));
    assert.match(reminder.message, /starts in 30 minutes/);
    assert.equal(summary.sent, 1);
  });

  test('a class starting now gets the starting-now reminder, not the 30-minute one', async () => {
    await makeInstance({ startTime: '10:00' });
    const now = new Date('2026-09-20T10:00:00+06:00');

    await runDueReminders(now);

    assert.equal(await Notification.countDocuments({ type: 'CLASS_STARTING' }), 1);
    assert.equal(await Notification.countDocuments({ type: 'CLASS_REMINDER' }), 0);
  });

  test('running twice notifies once — the idempotency rule', async () => {
    await makeInstance({ startTime: '10:30' });
    const now = new Date('2026-09-20T10:00:00+06:00');

    const first = await runDueReminders(now);
    const second = await runDueReminders(now);

    assert.equal(first.sent, 1);
    assert.equal(second.sent, 0, 'the second run inside the same window must be a no-op');
    assert.equal(await Notification.countDocuments(), 1);
  });

  test('a cancelled class reminds nobody', async () => {
    await makeInstance({ startTime: '10:30', status: 'CANCELLED' });
    const now = new Date('2026-09-20T10:00:00+06:00');

    const summary = await runDueReminders(now);
    assert.equal(summary.sent, 0);
    assert.equal(await Notification.countDocuments(), 0);
  });

  test('a class outside every window is left alone', async () => {
    await makeInstance({ startTime: '18:00', endTime: '19:30' });
    const now = new Date('2026-09-20T10:00:00+06:00');

    const summary = await runDueReminders(now);
    assert.equal(summary.scanned, 0);
    assert.equal(summary.sent, 0);
  });

  test('a student who opted out of the type receives nothing', async () => {
    student.notificationPreferences.types.set('CLASS_REMINDER', false);
    await student.save();
    await makeInstance({ startTime: '10:30' });

    await runDueReminders(new Date('2026-09-20T10:00:00+06:00'));
    assert.equal(await Notification.countDocuments({ type: 'CLASS_REMINDER' }), 0);
  });

  test('a student who opted out of push still gets the in-app notification', async () => {
    student.notificationPreferences.push = false;
    await student.save();
    await makeInstance({ startTime: '10:30' });

    await runDueReminders(new Date('2026-09-20T10:00:00+06:00'));
    assert.equal(await Notification.countDocuments({ type: 'CLASS_REMINDER' }), 1, 'push is a channel, not the record');
  });
});

describe('exam reminders', () => {
  test('an exam a day away reminds the students it targets', async () => {
    await AcademicEvent.create({
      department: cse._id, batch: batch14._id, semester: sem1._id, course: cse101._id,
      group: 'BOTH', title: 'CSE 101 CT-1', classType: 'CT', roomNumber: '501',
      date: '2026-09-21', startTime: '10:00', endTime: '11:00', createdBy: faculty._id,
    });

    const result = await runExamReminders(new Date('2026-09-20T10:00:00+06:00'));

    assert.equal(result.matched, 1);
    const reminder = await Notification.findOne({ type: 'EXAM_REMINDER' });
    assert.ok(reminder, 'the pre-existing EXAM_REMINDER type is finally emitted');
    assert.equal(String(reminder.recipient), String(student._id));
  });

  test('running twice does not duplicate an exam reminder', async () => {
    await AcademicEvent.create({
      department: cse._id, batch: batch14._id, semester: sem1._id, course: cse101._id,
      group: 'BOTH', title: 'CSE 101 CT-1', classType: 'CT',
      date: '2026-09-21', startTime: '10:00', endTime: '11:00', createdBy: faculty._id,
    });
    const now = new Date('2026-09-20T10:00:00+06:00');

    await runExamReminders(now);
    await runExamReminders(now);

    assert.equal(await Notification.countDocuments({ type: 'EXAM_REMINDER' }), 1);
  });
});
