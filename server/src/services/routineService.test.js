import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Course from '../models/Course.js';
import Batch from '../models/Batch.js';
import Semester from '../models/Semester.js';
import Settings, { getSettings } from '../models/Settings.js';
import RoutineTemplate from '../models/RoutineTemplate.js';
import ScheduleInstance from '../models/ScheduleInstance.js';
import AcademicEvent from '../models/AcademicEvent.js';
import { generateInstancesForTemplate, findConflicts, syncInstancesWithTemplate, applyBoundaryFor } from './routineService.js';
import { combineDhakaDateTime } from '../utils/academicSchedule.js';

// Recurrence expansion and the double-booking check.
//
// The properties that matter: only the rule's own weekdays are materialised,
// running the generator twice never duplicates a series, an occurrence that was
// individually cancelled survives a re-run, and a clash is reported for the
// room and for the faculty member separately.

before(async () => {
  await connectTestDb('routine-service');
});

after(async () => {
  await dropAndDisconnect();
});

let cse;
let sem1;
let batch14;
let cse101;
let rahman;
let karim;

beforeEach(async () => {
  await clearCollections(User, Department, Course, Batch, Semester, Settings, RoutineTemplate, ScheduleInstance, AcademicEvent);

  cse = await Department.create({ name: 'Computer Science', code: 'CSE' });
  sem1 = await Semester.create({ name: '1st Semester', code: 'SEM-1' });
  batch14 = await Batch.create({ name: 'BATCH-14', code: 'BATCH-14', department: cse._id });
  cse101 = await Course.create({ name: 'Data Structures', courseId: 'CSE-101', department: cse._id });

  rahman = await User.create({ name: 'Rahman', email: 'rahman@test.local', password: 'password123', role: 'faculty' });
  karim = await User.create({ name: 'Karim', email: 'karim@test.local', password: 'password123', role: 'faculty' });

  const settings = await getSettings();
  settings.routineSystemEnabled = true;
  await settings.save();
});

async function makeTemplate(overrides = {}) {
  return RoutineTemplate.create({
    department: cse._id,
    batch: batch14._id,
    semester: sem1._id,
    course: cse101._id,
    group: 'BOTH',
    faculty: rahman._id,
    roomNumber: '501',
    // 2026-09-20 is a Sunday; the range covers three Sundays.
    days: [0],
    startDate: '2026-09-20',
    endDate: '2026-10-04',
    startTime: '10:00',
    endTime: '11:30',
    createdBy: rahman._id,
    ...overrides,
  });
}

describe('recurring routine generation', () => {
  test('materialises one occurrence per matching weekday in the range', async () => {
    const template = await makeTemplate();
    const result = await generateInstancesForTemplate(template, rahman._id);

    assert.equal(result.created, 3, 'three Sundays: 20 Sep, 27 Sep, 4 Oct');

    const instances = await ScheduleInstance.find({ template: template._id }).sort({ date: 1 });
    assert.deepEqual(instances.map((i) => i.date), ['2026-09-20', '2026-09-27', '2026-10-04']);
  });

  test('skips weekdays the rule does not name', async () => {
    const template = await makeTemplate({ days: [0, 2] });
    await generateInstancesForTemplate(template, rahman._id);

    const dates = (await ScheduleInstance.find({ template: template._id }).sort({ date: 1 })).map((i) => i.date);
    assert.deepEqual(dates, ['2026-09-20', '2026-09-22', '2026-09-27', '2026-09-29', '2026-10-04']);
  });

  test('is idempotent — re-running adds nothing', async () => {
    const template = await makeTemplate();
    await generateInstancesForTemplate(template, rahman._id);

    const second = await generateInstancesForTemplate(template, rahman._id);
    assert.equal(second.created, 0);
    assert.equal(await ScheduleInstance.countDocuments({ template: template._id }), 3);
  });

  test('an individually cancelled occurrence survives regeneration', async () => {
    const template = await makeTemplate();
    await generateInstancesForTemplate(template, rahman._id);

    const target = await ScheduleInstance.findOne({ template: template._id, date: '2026-09-27' });
    target.status = 'CANCELLED';
    await target.save();

    await generateInstancesForTemplate(template, rahman._id);

    const after = await ScheduleInstance.findOne({ template: template._id, date: '2026-09-27' });
    assert.equal(after.status, 'CANCELLED', 'the exception must not be overwritten by the rule');
    assert.equal(await ScheduleInstance.countDocuments({ template: template._id }), 3);
  });

  test('the UTC instants match the Dhaka wall-clock the rule was entered in', async () => {
    const template = await makeTemplate({ startTime: '10:00', endTime: '11:30' });
    await generateInstancesForTemplate(template, rahman._id);

    const first = await ScheduleInstance.findOne({ template: template._id, date: '2026-09-20' });
    // 10:00 in Dhaka (+06:00, no DST) is 04:00 UTC.
    assert.equal(first.startAt.toISOString(), '2026-09-20T04:00:00.000Z');
    assert.equal(first.endAt.toISOString(), '2026-09-20T05:30:00.000Z');
  });
});

describe('conflict detection', () => {
  test('flags a room double-booking in the same department', async () => {
    const template = await makeTemplate();
    await generateInstancesForTemplate(template, rahman._id);

    const conflicts = await findConflicts([{
      department: cse._id,
      roomNumber: '501',
      faculty: karim._id,
      startAt: new Date('2026-09-20T04:30:00.000Z'),
      endAt: new Date('2026-09-20T06:00:00.000Z'),
    }]);

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].kind, 'ROOM');
  });

  test('flags a faculty member being in two places at once', async () => {
    const template = await makeTemplate();
    await generateInstancesForTemplate(template, rahman._id);

    const conflicts = await findConflicts([{
      department: cse._id,
      roomNumber: '999',
      faculty: rahman._id,
      startAt: new Date('2026-09-20T04:30:00.000Z'),
      endAt: new Date('2026-09-20T06:00:00.000Z'),
    }]);

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].kind, 'FACULTY');
  });

  test('back-to-back slots do not conflict', async () => {
    const template = await makeTemplate();
    await generateInstancesForTemplate(template, rahman._id);

    // Starts exactly when the 10:00–11:30 class ends.
    const conflicts = await findConflicts([{
      department: cse._id,
      roomNumber: '501',
      faculty: rahman._id,
      startAt: new Date('2026-09-20T05:30:00.000Z'),
      endAt: new Date('2026-09-20T07:00:00.000Z'),
    }]);

    assert.deepEqual(conflicts, []);
  });

  test('a cancelled occurrence frees the room', async () => {
    const template = await makeTemplate();
    await generateInstancesForTemplate(template, rahman._id);

    await ScheduleInstance.updateMany({ template: template._id }, { status: 'CANCELLED' });

    const conflicts = await findConflicts([{
      department: cse._id,
      roomNumber: '501',
      faculty: rahman._id,
      startAt: new Date('2026-09-20T04:30:00.000Z'),
      endAt: new Date('2026-09-20T06:00:00.000Z'),
    }]);

    assert.deepEqual(conflicts, [], 'a cancelled class is not occupying anything');
  });

  test('an exam in the same room and window is a conflict too', async () => {
    await AcademicEvent.create({
      department: cse._id, batch: batch14._id, semester: sem1._id, course: cse101._id,
      group: 'BOTH', title: 'CT-1', classType: 'CT', roomNumber: '501',
      date: '2026-09-20', startTime: '10:00', endTime: '11:00', createdBy: rahman._id,
    });

    const conflicts = await findConflicts([{
      department: cse._id,
      roomNumber: '501',
      faculty: null,
      startAt: new Date('2026-09-20T04:30:00.000Z'),
      endAt: new Date('2026-09-20T05:00:00.000Z'),
    }]);

    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].kind, 'ROOM');
  });

  test('the row being edited is not reported as its own conflict', async () => {
    const template = await makeTemplate();
    await generateInstancesForTemplate(template, rahman._id);
    const instance = await ScheduleInstance.findOne({ template: template._id });

    const conflicts = await findConflicts([instance.toObject()], { excludeIds: [instance._id] });
    assert.deepEqual(conflicts, []);
  });
});

describe('template validation', () => {
  test('rejects an end time that is not after the start time', async () => {
    await assert.rejects(
      () => makeTemplate({ startTime: '11:30', endTime: '10:00' }),
      /endTime must be after startTime/
    );
  });

  test('rejects a rule with no weekdays', async () => {
    await assert.rejects(() => makeTemplate({ days: [] }), /days must contain at least one weekday/);
  });

  test('requires a link for an online class', async () => {
    await assert.rejects(
      () => makeTemplate({ deliveryMode: 'ONLINE' }),
      /online link is required/i
    );
    const ok = await makeTemplate({ deliveryMode: 'ONLINE', onlineLink: 'https://meet.example/x' });
    assert.equal(ok.deliveryMode, 'ONLINE');
  });
});

describe('routine -> occurrence synchronisation', () => {
  /** A rule covering every day of a short range, so nothing here depends on which weekday a date falls on. */
  async function makeDaily(overrides = {}) {
    const template = await makeTemplate({
      days: [0, 1, 2, 3, 4, 5, 6],
      startDate: '2026-09-20',
      endDate: '2026-09-22',
      ...overrides,
    });
    await generateInstancesForTemplate(template, rahman._id);
    return template;
  }

  test('editing the routine rewrites every inherited field on its occurrences', async () => {
    const template = await makeDaily();
    template.startTime = '14:00';
    template.endTime = '15:30';
    template.roomNumber = '777';
    await template.save();

    const result = await syncInstancesWithTemplate(template, { from: new Date(0), actorId: rahman._id });
    assert.equal(result.updated, 3);

    const rows = await ScheduleInstance.find({ template: template._id }).sort({ date: 1 });
    for (const row of rows) {
      assert.equal(row.startTime, '14:00');
      assert.equal(row.endTime, '15:30');
      assert.equal(row.roomNumber, '777');
      assert.deepEqual(row.overriddenFields, [], 'a plain copy holds no overrides');
    }
    // The derived instant follows the wall-clock — that is what the widget and
    // the reminder engine actually read.
    assert.equal(rows[0].startAt.toISOString(), '2026-09-20T08:00:00.000Z');
  });

  test('a date that changed a field for itself keeps it while everything else follows', async () => {
    const template = await makeDaily();

    const target = await ScheduleInstance.findOne({ template: template._id, date: '2026-09-21' });
    target.roomNumber = '603';
    target.overriddenFields = ['roomNumber'];
    await target.save();

    template.startTime = '14:00';
    template.endTime = '15:30';
    template.roomNumber = '777';
    await template.save();
    await syncInstancesWithTemplate(template, { from: new Date(0), actorId: rahman._id });

    const after = await ScheduleInstance.findOne({ template: template._id, date: '2026-09-21' });
    assert.equal(after.roomNumber, '603', 'the override survives the routine edit');
    assert.equal(after.startTime, '14:00', 'the field it did not change still inherits');
  });

  test('history is left alone unless the caller reaches back for it', async () => {
    const template = await makeDaily();
    template.startTime = '14:00';
    template.endTime = '15:30';
    await template.save();

    const result = await syncInstancesWithTemplate(template, {
      from: combineDhakaDateTime('2026-09-22', '00:00'),
      actorId: rahman._id,
    });

    assert.equal(result.updated, 1, 'only the last date is in scope');
    const first = await ScheduleInstance.findOne({ template: template._id, date: '2026-09-20' });
    assert.equal(first.startTime, '10:00', 'the completed date keeps its history');
  });

  test('a date the rule no longer covers is removed while it is still a plain copy', async () => {
    const template = await makeDaily();
    template.days = [0]; // Sundays only
    await template.save();

    const result = await syncInstancesWithTemplate(template, { from: new Date(0), actorId: rahman._id });

    assert.equal(result.removed, 2, 'the Monday and the Tuesday are gone');
    const dates = (await ScheduleInstance.find({ template: template._id })).map((row) => row.date);
    assert.deepEqual(dates, ['2026-09-20']);
  });

  test('a date carrying an exception survives its weekday being dropped', async () => {
    const template = await makeDaily();

    const keeping = await ScheduleInstance.findOne({ template: template._id, date: '2026-09-21' });
    keeping.roomNumber = '603';
    keeping.overriddenFields = ['roomNumber'];
    await keeping.save();

    template.days = [0];
    await template.save();
    const result = await syncInstancesWithTemplate(template, { from: new Date(0), actorId: rahman._id });

    assert.equal(result.removed, 1, 'only the untouched date is removed');
    assert.ok(await ScheduleInstance.findOne({ template: template._id, date: '2026-09-21' }));
  });

  test('is a no-op when the occurrences already match the rule', async () => {
    const template = await makeDaily();
    const result = await syncInstancesWithTemplate(template, { from: new Date(0), actorId: rahman._id });
    assert.equal(result.updated, 0);
    assert.equal(result.removed, 0);
    assert.equal(result.changed.length, 0);
  });
});

describe('apply scope', () => {
  test('entire reaches back to the beginning of time', async () => {
    const template = await makeTemplate();
    assert.deepEqual(await applyBoundaryFor(template, { scope: 'entire' }), new Date(0));
  });

  test('the default is "from now" — all future classes', async () => {
    const template = await makeTemplate();
    const now = new Date('2026-09-20T10:00:00+06:00');
    assert.deepEqual(await applyBoundaryFor(template, { now }), now);
    assert.deepEqual(await applyBoundaryFor(template, { scope: 'all', now }), now);
  });

  test('today starts at the beginning of the Dhaka day', async () => {
    const template = await makeTemplate();
    const boundary = await applyBoundaryFor(template, { scope: 'today', now: new Date('2026-09-20T10:00:00+06:00') });
    assert.equal(boundary.toISOString(), '2026-09-19T18:00:00.000Z');
  });

  test('date uses the chosen day, and a missing one is rejected', async () => {
    const template = await makeTemplate();
    const boundary = await applyBoundaryFor(template, { scope: 'date', date: '2026-10-04' });
    assert.equal(boundary.toISOString(), '2026-10-03T18:00:00.000Z');

    await assert.rejects(() => applyBoundaryFor(template, { scope: 'date' }), /applyFromDate/);
  });

  test('next is the start of the next occurrence', async () => {
    const template = await makeTemplate();
    await generateInstancesForTemplate(template, rahman._id);

    const boundary = await applyBoundaryFor(template, { scope: 'next', now: new Date('2026-09-25T00:00:00Z') });
    assert.equal(boundary.toISOString(), '2026-09-27T04:00:00.000Z');
  });
});
