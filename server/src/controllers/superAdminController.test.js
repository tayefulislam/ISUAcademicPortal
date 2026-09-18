import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import Settings from '../models/Settings.js';
import { updateUserApproval, updateUserProfile, getSystemSettings, updateSystemSettings } from './superAdminController.js';

// Manual Student ID approval override — the "just fix it" escape hatch for
// Super Admin/Administrator, distinct from the pending-queue-only
// approveStudent/rejectStudent in studentApprovalController.js (already
// covered by studentApprovalController.test.js). This can move a student to
// ANY approvalStatus from ANY current one; role gating (super_admin/
// administrator only) is enforced entirely at the route level
// (requireSuperAdminTier in superAdminRoutes.js), so these tests exercise
// the controller's own business rules directly, same convention as the
// other controller test files (direct call against a real disposable
// Mongo, asyncHandler's next(err) captured as `error`).

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

async function call(fn, { user, params = {}, body = {} }) {
  const req = { user, params, body };
  const res = fakeRes();
  let error;
  await fn(req, res, (err) => {
    error = err;
  });
  return { res, error };
}

before(async () => {
  await connectTestDb('super-admin-manual-approval');
});

after(async () => {
  await dropAndDisconnect();
});

let superAdminUser, pendingStudent, approvedStudent, rejectedStudent, facultyUser;

beforeEach(async () => {
  await clearCollections(User);

  const mk = (overrides) =>
    User.create({ name: 'X', email: `${Math.random().toString(36).slice(2)}@test.local`, password: 'password123', role: 'student', ...overrides });

  superAdminUser = await mk({ role: 'super_admin' });
  facultyUser = await mk({ role: 'faculty' });
  pendingStudent = await mk({ approvalStatus: 'pending', approvalHistory: [{ action: 'SUBMITTED', performedBy: null, performedAt: new Date() }] });
  approvedStudent = await mk({ approvalStatus: 'approved' });
  rejectedStudent = await mk({ approvalStatus: 'rejected', rejectionReason: 'old reason' });
});

describe('updateUserApproval — manual override', () => {
  test('moves a pending student straight to approved', async () => {
    const { res, error } = await call(updateUserApproval, {
      user: superAdminUser,
      params: { id: pendingStudent._id.toString() },
      body: { approvalStatus: 'approved' },
    });
    assert.equal(error, undefined);
    assert.equal(res.body.data.approvalStatus, 'approved');
    assert.equal(res.body.data.approvalRole, 'super_admin');
    const last = res.body.data.approvalHistory.at(-1);
    assert.equal(last.action, 'MANUAL_OVERRIDE');
    assert.match(last.reason, /pending.*approved/);
  });

  test('force-approves an already-rejected student (bypassing resubmission entirely)', async () => {
    const { res, error } = await call(updateUserApproval, {
      user: superAdminUser,
      params: { id: rejectedStudent._id.toString() },
      body: { approvalStatus: 'approved' },
    });
    assert.equal(error, undefined);
    assert.equal(res.body.data.approvalStatus, 'approved');
    assert.equal(res.body.data.rejectionReason, ''); // cleared
  });

  test('reverts an already-approved student back to pending', async () => {
    const { res, error } = await call(updateUserApproval, {
      user: superAdminUser,
      params: { id: approvedStudent._id.toString() },
      body: { approvalStatus: 'pending' },
    });
    assert.equal(error, undefined);
    assert.equal(res.body.data.approvalStatus, 'pending');
  });

  test('manually rejecting stores the reason and clears any stored Student ID image', async () => {
    pendingStudent.studentIdImage = {
      provider: 'imgbb', url: 'https://i.ibb.co/fake.jpg', key: 'https://ibb.co/delete/fake', bucket: '', size: 111, mimeType: 'image/jpeg', uploadedAt: new Date(),
    };
    await pendingStudent.save();

    const { res, error } = await call(updateUserApproval, {
      user: superAdminUser,
      params: { id: pendingStudent._id.toString() },
      body: { approvalStatus: 'rejected', reason: 'Manual check failed' },
    });
    assert.equal(error, undefined);
    assert.equal(res.body.data.approvalStatus, 'rejected');
    assert.equal(res.body.data.rejectionReason, 'Manual check failed');

    const fresh = await User.findById(pendingStudent._id).select('+studentIdImage.key');
    assert.equal(fresh.studentIdImage.key, '');
  });

  test('rejects an invalid approvalStatus value -> 400', async () => {
    const { error } = await call(updateUserApproval, {
      user: superAdminUser,
      params: { id: pendingStudent._id.toString() },
      body: { approvalStatus: 'blocked' },
    });
    assert.equal(error?.statusCode, 400);
  });

  test('no-op when already at the requested status -> 400', async () => {
    const { error } = await call(updateUserApproval, {
      user: superAdminUser,
      params: { id: approvedStudent._id.toString() },
      body: { approvalStatus: 'approved' },
    });
    assert.equal(error?.statusCode, 400);
  });

  test('cannot target a non-student account -> 400', async () => {
    const { error } = await call(updateUserApproval, {
      user: superAdminUser,
      params: { id: facultyUser._id.toString() },
      body: { approvalStatus: 'approved' },
    });
    assert.equal(error?.statusCode, 400);
  });

  test('target not found -> 404', async () => {
    const { error } = await call(updateUserApproval, {
      user: superAdminUser,
      params: { id: '6a9c942f753d5d4e5c5f2b1b' },
      body: { approvalStatus: 'approved' },
    });
    assert.equal(error?.statusCode, 404);
  });

  test('bumps tokenVersion so a stale session re-checks access', async () => {
    const before = pendingStudent.tokenVersion;
    await call(updateUserApproval, {
      user: superAdminUser,
      params: { id: pendingStudent._id.toString() },
      body: { approvalStatus: 'approved' },
    });
    const fresh = await User.findById(pendingStudent._id);
    assert.equal(fresh.tokenVersion, before + 1);
  });
});

describe('updateSystemSettings — officialEmailDomains (list setting)', () => {
  beforeEach(async () => {
    await clearCollections(Settings);
  });

  test('a fresh deployment defaults to ["isu.ac.bd"]', async () => {
    const { res, error } = await call(getSystemSettings, { user: superAdminUser });
    assert.equal(error, undefined);
    assert.deepEqual(res.body.data.officialEmailDomains, ['isu.ac.bd']);
  });

  test('replaces the whole list, normalizing each entry (lowercase, trim, strip leading @, dedupe)', async () => {
    const { res, error } = await call(updateSystemSettings, {
      user: superAdminUser,
      body: { officialEmailDomains: ['  ISU.AC.BD ', '@grad.isu.ac.bd', 'grad.isu.ac.bd'] },
    });
    assert.equal(error, undefined);
    assert.deepEqual(res.body.data.officialEmailDomains.sort(), ['grad.isu.ac.bd', 'isu.ac.bd'].sort());
  });

  test('rejects an entry that is not a valid domain shape', async () => {
    const { error } = await call(updateSystemSettings, {
      user: superAdminUser,
      body: { officialEmailDomains: ['not a domain'] },
    });
    assert.equal(error?.statusCode, 400);
  });

  test('an empty array is a valid replacement (turns off official-domain auto-approval entirely)', async () => {
    const { res, error } = await call(updateSystemSettings, {
      user: superAdminUser,
      body: { officialEmailDomains: [] },
    });
    assert.equal(error, undefined);
    assert.deepEqual(res.body.data.officialEmailDomains, []);
  });

  test('migrates a pre-existing legacy studentAutoApprovalDomain value on first read', async () => {
    await Settings.create({ key: 'global', studentAutoApprovalDomain: 'legacy-domain.edu' });
    const { res, error } = await call(getSystemSettings, { user: superAdminUser });
    assert.equal(error, undefined);
    assert.deepEqual(res.body.data.officialEmailDomains, ['legacy-domain.edu']);
  });
});

// A student's class group (BOTH / A1 / A2 / ...) can be set here by an
// administrator, and it is the only place a WRONG group gets corrected — the
// student states their own at registration and in their profile, and this is how
// staff fix it. Same field, same validation, whichever side writes it.
describe('updateUserProfile — academic group', () => {
  const target = () => ({ user: superAdminUser, params: { id: String(approvedStudent._id) } });

  test('sets a configured group, normalized to upper case', async () => {
    const { res, error } = await call(updateUserProfile, { ...target(), body: { group: 'a1' } });
    assert.equal(error, undefined);
    assert.equal(res.body.data.group, 'A1');
  });

  test('rejects a group that is not configured', async () => {
    const { error } = await call(updateUserProfile, { ...target(), body: { group: 'ZZ9' } });
    assert.equal(error?.statusCode, 400);
  });

  test('an empty or omitted value means the whole batch', async () => {
    await call(updateUserProfile, { ...target(), body: { group: 'A2' } });
    const { res } = await call(updateUserProfile, { ...target(), body: { group: '' } });
    assert.equal(res.body.data.group, 'BOTH');
  });

  test('an unrelated edit through this endpoint leaves the group alone', async () => {
    await call(updateUserProfile, { ...target(), body: { group: 'A1' } });
    const { res } = await call(updateUserProfile, { ...target(), body: { name: 'Renamed' } });
    assert.equal(res.body.data.group, 'A1');
  });
});
