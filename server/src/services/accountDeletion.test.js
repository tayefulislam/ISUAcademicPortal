import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import AccountDeletionRequest from '../models/AccountDeletionRequest.js';
import {
  requestDeletion,
  myRequest,
  listRequests,
  approveRequest,
  rejectRequest,
} from './accountDeletionService.js';

// Account deletion. The rule under test: a request deletes nothing by itself,
// approval erases the person's identifying data and closes the account, and
// rejection leaves the account exactly as it was.

const OLD_PASSWORD = 'OriginalPass123';

before(async () => {
  await connectTestDb('account-deletion');
});

after(async () => {
  await dropAndDisconnect();
});

beforeEach(async () => {
  await clearCollections(User, AccountDeletionRequest);
});

async function makeUser(overrides = {}) {
  return User.create({
    name: 'Test Student',
    email: `student${Date.now()}${Math.random().toString(16).slice(2)}@example.com`,
    password: OLD_PASSWORD,
    role: 'student',
    rollNo: '2818540994349846',
    phone: '01724364698',
    ...overrides,
  });
}

describe('requestDeletion', () => {
  test('a request is recorded and deletes nothing', async () => {
    const user = await makeUser();

    const request = await requestDeletion(user, 'I am leaving the university');
    assert.equal(request.status, 'pending');
    assert.match(request.reason, /leaving/);

    const still = await User.findById(user._id).select('+password');
    assert.equal(still.name, 'Test Student');
    assert.equal(still.status, 'active');
    assert.ok(await still.comparePassword(OLD_PASSWORD), 'the password is untouched by a request');
  });

  test('asking twice keeps a single pending request', async () => {
    const user = await makeUser();

    await requestDeletion(user, 'first');
    await requestDeletion(user, 'second');

    assert.equal(await AccountDeletionRequest.countDocuments({ user: user._id }), 1);
    assert.equal((await myRequest(user)).reason, 'first', 'the original request is returned');
  });
});

describe('approveRequest', () => {
  test('erases identifying data and closes the account', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'super_admin', email: 'admin@example.com', rollNo: '', phone: '' });
    const request = await requestDeletion(user, 'please delete');

    const done = await approveRequest(admin, request.id, 'Approved per policy');
    assert.equal(done.status, 'approved');
    assert.ok(done.completedAt);

    const after = await User.findById(user._id).select('+password');
    assert.equal(after.name, 'Deleted user');
    assert.notEqual(after.email, user.email);
    assert.match(after.email, /^deleted\+/);
    assert.equal(after.phone, '');
    assert.equal(after.rollNo, '');
    assert.equal(after.status, 'blocked');
    assert.equal(after.approvalStatus, 'blocked');
    assert.ok(after.tokenVersion > 0, 'existing sessions are invalidated');
    assert.equal(await after.comparePassword(OLD_PASSWORD), false, 'the old password no longer works');
  });

  test('the academic records it must keep are not in this service at all — the account row survives', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'super_admin', email: 'admin2@example.com', rollNo: '', phone: '' });
    const request = await requestDeletion(user);

    await approveRequest(admin, request.id);

    // Anonymised, not deleted: every historical row that references this user
    // still resolves.
    assert.ok(await User.findById(user._id));
  });

  test('a request that was already reviewed is refused', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'super_admin', email: 'admin3@example.com', rollNo: '', phone: '' });
    const request = await requestDeletion(user);
    await approveRequest(admin, request.id);

    await assert.rejects(() => approveRequest(admin, request.id), (error) => error.statusCode === 409);
  });

  test('an account already gone still closes the request out', async () => {
    const admin = await makeUser({ role: 'super_admin', email: 'admin4@example.com', rollNo: '', phone: '' });
    const orphan = await AccountDeletionRequest.create({
      user: new mongoose.Types.ObjectId(),
      reason: 'account removed by other means',
    });

    const done = await approveRequest(admin, String(orphan._id));
    assert.equal(done.status, 'approved');
  });
});

describe('rejectRequest', () => {
  test('leaves the account exactly as it was', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'super_admin', email: 'admin5@example.com', rollNo: '', phone: '' });
    const request = await requestDeletion(user);

    const done = await rejectRequest(admin, request.id, 'Records must be retained');
    assert.equal(done.status, 'rejected');

    const after = await User.findById(user._id).select('+password');
    assert.equal(after.name, 'Test Student');
    assert.equal(after.status, 'active');
    assert.equal(after.tokenVersion, 0);
    assert.ok(await after.comparePassword(OLD_PASSWORD));
  });
});

describe('listRequests', () => {
  test('filters by status and reports the caller', async () => {
    const one = await makeUser({ email: 'a@example.com', rollNo: '', phone: '' });
    const two = await makeUser({ email: 'b@example.com', rollNo: '', phone: '' });
    const admin = await makeUser({ role: 'super_admin', email: 'admin6@example.com', rollNo: '', phone: '' });

    await requestDeletion(one);
    await requestDeletion(two);
    const toReject = await requestDeletion(one); // same pending request, kept for clarity
    await rejectRequest(admin, toReject.id);

    const pending = await listRequests({ status: 'pending' });
    assert.equal(pending.items.length, 1);
    assert.equal(pending.items[0].user.email, 'b@example.com');

    const rejected = await listRequests({ status: 'rejected' });
    assert.equal(rejected.items.length, 1);
  });
});
