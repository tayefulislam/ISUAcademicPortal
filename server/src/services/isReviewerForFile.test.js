import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import Department from '../models/Department.js';
import Course from '../models/Course.js';
import Role from '../models/Role.js';
import { isReviewerForFile } from './fileQueryBuilder.js';

// isReviewerForFile is the single source of truth for who may see/open a file
// while it is still pending review — the review controller's scope and the
// notification reviewer resolution both mirror it. This pins the rule that a
// custom admin-tier role (e.g. "CR") needs BOTH the `reviews` permission AND a
// matching assignment, which is what lets a scoped CR preview a submission.

before(async () => {
  await connectTestDb('reviewer-access');
});

after(async () => {
  await dropAndDisconnect();
});

let deptA, deptB, courseInA, courseInB;

// A File document's department/course are ObjectIds, so the helper passes ids —
// exactly what isFacultyScopedToFile compares against.
const fileIn = (course, department) => ({ department, course });

beforeEach(async () => {
  await clearCollections(User, Department, Course, Role);

  deptA = await Department.create({ name: 'Computer Science', code: 'CSE' });
  deptB = await Department.create({ name: 'Electrical Engineering', code: 'EEE' });
  courseInA = await Course.create({ name: 'Data Structures', courseId: 'CSE-301', department: deptA._id });
  courseInB = await Course.create({ name: 'Circuits', courseId: 'EEE-201', department: deptB._id });
});

const mkUser = (overrides) => ({
  role: 'student',
  assignedDepartments: [],
  assignedCourses: [],
  ...overrides,
});

describe('isReviewerForFile', () => {
  test('the unrestricted reviewer roles see any pending file', async () => {
    for (const role of ['admin', 'super_admin', 'administrator']) {
      assert.equal(await isReviewerForFile(mkUser({ role }), fileIn(courseInB._id, deptB._id)), true);
    }
  });

  test('faculty is scoped to their assigned Department/Course', async () => {
    const scoped = mkUser({ role: 'faculty', assignedCourses: [courseInA._id] });
    assert.equal(await isReviewerForFile(scoped, fileIn(courseInA._id, deptA._id)), true);
    assert.equal(await isReviewerForFile(scoped, fileIn(courseInB._id, deptB._id)), false);
  });

  test('a CR with the reviews permission sees a file in its own scope', async () => {
    await Role.create({ key: 'cr', name: 'CR', permissions: ['reviews'] });
    const cr = mkUser({ role: 'cr', assignedDepartments: [deptA._id] });
    assert.equal(await isReviewerForFile(cr, fileIn(courseInA._id, deptA._id)), true);
  });

  test('a CR without the reviews permission is not a reviewer', async () => {
    await Role.create({ key: 'cr', name: 'CR', permissions: ['files'] });
    const cr = mkUser({ role: 'cr', assignedDepartments: [deptA._id] });
    assert.equal(await isReviewerForFile(cr, fileIn(courseInA._id, deptA._id)), false);
  });

  test('a CR with the reviews permission but no matching scope is not a reviewer', async () => {
    await Role.create({ key: 'cr', name: 'CR', permissions: ['reviews'] });
    const cr = mkUser({ role: 'cr', assignedDepartments: [deptA._id] });
    assert.equal(await isReviewerForFile(cr, fileIn(courseInB._id, deptB._id)), false);
  });

  test('a student is never a reviewer', async () => {
    assert.equal(await isReviewerForFile(mkUser({ role: 'student' }), fileIn(courseInA._id, deptA._id)), false);
  });

  test('a missing user or file is not reviewable', async () => {
    assert.equal(await isReviewerForFile(null, fileIn(courseInA._id, deptA._id)), false);
    assert.equal(await isReviewerForFile(mkUser({ role: 'admin' }), null), false);
  });
});
