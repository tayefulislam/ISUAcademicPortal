import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import Settings, { updateSettings } from '../models/Settings.js';
import { isBlockedByApproval } from './courseAccessService.js';

// isBlockedByApproval is the single gate everything that requires login
// (File content, Assignment submission, Quiz attempts, Messaging) checks
// before letting a student in — see its own doc comment. Exercised against a
// real disposable MongoDB, matching this repo's other service-level suites.

before(async () => {
  await connectTestDb('course-access-approval-gate');
});

after(async () => {
  await dropAndDisconnect();
});

beforeEach(async () => {
  await clearCollections(User, Settings);
});

describe('isBlockedByApproval', () => {
  test('returns false for a null/undefined user', async () => {
    assert.equal(await isBlockedByApproval(null), false);
    assert.equal(await isBlockedByApproval(undefined), false);
  });

  test('returns false for any non-student role, even if pending-shaped (faculty/admin/super_admin never gated)', async () => {
    await updateSettings({ studentApprovalEnabled: true });
    for (const role of ['faculty', 'admin', 'administrator', 'super_admin']) {
      const user = await User.create({ name: 'X', email: `${role}@test.local`, password: 'password123', role, approvalStatus: 'pending' });
      assert.equal(await isBlockedByApproval(user), false, `expected role "${role}" to never be gated`);
    }
  });

  test('returns false for an approved student regardless of the toggle', async () => {
    const approved = await User.create({ name: 'S', email: 'approved@test.local', password: 'password123', role: 'student', approvalStatus: 'approved' });
    await updateSettings({ studentApprovalEnabled: true });
    assert.equal(await isBlockedByApproval(approved), false);
    await updateSettings({ studentApprovalEnabled: false });
    assert.equal(await isBlockedByApproval(approved), false);
  });

  test('returns false for a pending student while the approval system is OFF (toggle gates the gate itself)', async () => {
    const pending = await User.create({ name: 'S', email: 'pending1@test.local', password: 'password123', role: 'student', approvalStatus: 'pending' });
    await updateSettings({ studentApprovalEnabled: false });
    assert.equal(await isBlockedByApproval(pending), false);
  });

  test('returns true for a pending student while the approval system is ON', async () => {
    const pending = await User.create({ name: 'S', email: 'pending2@test.local', password: 'password123', role: 'student', approvalStatus: 'pending' });
    await updateSettings({ studentApprovalEnabled: true });
    assert.equal(await isBlockedByApproval(pending), true);
  });

  test('returns true for a rejected student while the approval system is ON', async () => {
    const rejected = await User.create({ name: 'S', email: 'rejected@test.local', password: 'password123', role: 'student', approvalStatus: 'rejected' });
    await updateSettings({ studentApprovalEnabled: true });
    assert.equal(await isBlockedByApproval(rejected), true);
  });

  test('turning the toggle back on/off immediately flips the result for the same pending student', async () => {
    const pending = await User.create({ name: 'S', email: 'pending3@test.local', password: 'password123', role: 'student', approvalStatus: 'pending' });
    await updateSettings({ studentApprovalEnabled: true });
    assert.equal(await isBlockedByApproval(pending), true);
    await updateSettings({ studentApprovalEnabled: false });
    assert.equal(await isBlockedByApproval(pending), false);
    await updateSettings({ studentApprovalEnabled: true });
    assert.equal(await isBlockedByApproval(pending), true);
  });
});
