import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Batch from '../models/Batch.js';
import Role from '../models/Role.js';
// Not used directly — profileController.js's POPULATE list includes
// 'semester'. Mongoose needs the schema registered in this test process
// (each test file runs in its own worker) or populate throws MissingSchemaError.
import '../models/Semester.js';
import { updateProfile } from './profileController.js';

// Department/Batch are academic-record fields — a Student or a CR (still a
// student underneath) must not be able to move themselves to a different
// department/batch via their own profile form, even by calling the API
// directly with those fields in the body. Every other role is unaffected.

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

async function call(fn, { user, body = {} }) {
  const req = { user, body };
  const res = fakeRes();
  let error;
  await fn(req, res, (err) => {
    error = err;
  });
  return { res, error };
}

before(async () => {
  await connectTestDb('profile-dept-batch-lock');
});

after(async () => {
  await dropAndDisconnect();
});

let deptA, deptB, batchA, batchB;

beforeEach(async () => {
  await clearCollections(User, Department, Batch, Role);
  deptA = await Department.create({ name: 'Computer Science', code: 'CSE' });
  deptB = await Department.create({ name: 'Electrical Engineering', code: 'EEE' });
  batchA = await Batch.create({ name: 'BATCH-14', code: 'BATCH-14' });
  batchB = await Batch.create({ name: 'BATCH-15', code: 'BATCH-15' });
  await Role.create({ key: 'cr', name: 'CR', permissions: ['approvals'] });
});

describe('updateProfile — Department/Batch locked for Student and CR', () => {
  test('student cannot change department/batch via the API, even though other fields still apply', async () => {
    const student = await User.create({
      name: 'S', email: 's@test.local', password: 'password123', role: 'student', department: deptA._id, batch: batchA._id,
    });
    const { res, error } = await call(updateProfile, {
      user: student,
      body: { name: 'New Name', department: deptB._id.toString(), batch: batchB._id.toString() },
    });
    assert.equal(error, undefined);
    assert.equal(res.body.data.name, 'New Name');
    assert.equal(String(res.body.data.department._id), deptA._id.toString()); // unchanged
    assert.equal(String(res.body.data.batch._id), batchA._id.toString()); // unchanged
  });

  test('CR (custom admin-tier role) cannot change department/batch via the API either', async () => {
    const cr = await User.create({
      name: 'CR Person', email: 'cr@test.local', password: 'password123', role: 'cr', department: deptA._id, batch: batchA._id,
    });
    const { res, error } = await call(updateProfile, {
      user: cr,
      body: { department: deptB._id.toString(), batch: batchB._id.toString() },
    });
    assert.equal(error, undefined);
    assert.equal(String(res.body.data.department._id), deptA._id.toString());
    assert.equal(String(res.body.data.batch._id), batchA._id.toString());
  });

  test('student can still edit rollNo/phone/semester — only department/batch are locked', async () => {
    const student = await User.create({ name: 'S', email: 's2@test.local', password: 'password123', role: 'student' });
    const { res, error } = await call(updateProfile, { user: student, body: { rollNo: '1234567890123456' } });
    assert.equal(error, undefined);
    assert.equal(res.body.data.rollNo, '1234567890123456');
  });

  test('faculty is unaffected — can still update department/batch (unchanged prior behavior)', async () => {
    const faculty = await User.create({ name: 'F', email: 'f@test.local', password: 'password123', role: 'faculty' });
    const { res, error } = await call(updateProfile, {
      user: faculty,
      body: { department: deptA._id.toString(), batch: batchA._id.toString() },
    });
    assert.equal(error, undefined);
    assert.equal(String(res.body.data.department._id), deptA._id.toString());
    assert.equal(String(res.body.data.batch._id), batchA._id.toString());
  });

  test('the unrestricted "admin" role is unaffected (not treated as CR-like)', async () => {
    const admin = await User.create({ name: 'A', email: 'a@test.local', password: 'password123', role: 'admin' });
    const { res, error } = await call(updateProfile, {
      user: admin,
      body: { department: deptA._id.toString(), batch: batchA._id.toString() },
    });
    assert.equal(error, undefined);
    assert.equal(String(res.body.data.department._id), deptA._id.toString());
    assert.equal(String(res.body.data.batch._id), batchA._id.toString());
  });
});

// A class group (BOTH / A1 / A2 …) is deliberately NOT locked alongside
// department/batch. Moving department or batch moves someone across cohorts,
// which is why the academic office owns those; a group only decides which part of
// the student's own batch's timetable they are shown. It is useless as data unless
// the student can state it, so it is self-service — and validated against the
// configured list like every other write of this field.
describe('updateProfile — the student sets their own class group', () => {
  test('a student sets their own group, normalized to upper case', async () => {
    const student = await User.create({ name: 'S', email: 'g1@test.local', password: 'password123', role: 'student' });
    const { res, error } = await call(updateProfile, { user: student, body: { group: 'a1' } });

    assert.equal(error, undefined);
    assert.equal(res.body.data.group, 'A1');
  });

  test('an empty group means the whole batch', async () => {
    const student = await User.create({
      name: 'S', email: 'g2@test.local', password: 'password123', role: 'student', group: 'A2',
    });
    const { res } = await call(updateProfile, { user: student, body: { group: '' } });

    assert.equal(res.body.data.group, 'BOTH');
  });

  test('a group that is not configured is rejected', async () => {
    const student = await User.create({ name: 'S', email: 'g3@test.local', password: 'password123', role: 'student' });
    const { error } = await call(updateProfile, { user: student, body: { group: 'ZZ9' } });

    assert.equal(error?.statusCode, 400);
  });

  test('setting a group does not unlock department/batch in the same call', async () => {
    const student = await User.create({
      name: 'S', email: 'g4@test.local', password: 'password123', role: 'student',
      department: deptA._id, batch: batchA._id,
    });
    const { res, error } = await call(updateProfile, {
      user: student,
      body: { group: 'A1', department: deptB._id.toString(), batch: batchB._id.toString() },
    });

    assert.equal(error, undefined);
    assert.equal(res.body.data.group, 'A1', 'the group is the student to state');
    assert.equal(String(res.body.data.department._id), deptA._id.toString(), 'the department is not');
    assert.equal(String(res.body.data.batch._id), batchA._id.toString(), 'the batch is not');
  });
});
