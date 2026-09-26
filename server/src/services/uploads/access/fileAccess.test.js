import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessStoredFile, assertCanAccess, assertOwnerOrAdmin, isOwner } from './fileAccess.js';

/**
 * The access boundary (§18) — the spec's non-negotiable:
 *
 *   "A student must never be able to access another student's private file by
 *    changing a URL or file ID."
 *
 * These tests exercise that rule directly. The `course` visibility branch calls
 * into the database (getEffectiveCourseIds) and is therefore covered by the
 * DB-backed suite; every other branch is pure and is pinned here.
 */

const OWNER = 'owner-1';
const OTHER = 'student-2';

function record(overrides = {}) {
  return { _id: 'file-1', ownerId: OWNER, visibility: 'private', ...overrides };
}

function user(id, extra = {}) {
  return { _id: id, role: 'student', ...extra };
}

test('the owner can always reach their own file, whatever the policy', async () => {
  for (const visibility of ['private', 'role', 'department', 'batch', 'public']) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal(await canAccessStoredFile(record({ visibility }), user(OWNER)), true, `owner + ${visibility}`);
  }
});

test('a private file is unreachable by anyone else — the core guarantee', async () => {
  const file = record({ visibility: 'private' });
  assert.equal(await canAccessStoredFile(file, user(OTHER)), false);
  assert.equal(await canAccessStoredFile(file, null), false);
  assert.equal(await canAccessStoredFile(file, undefined), false);
});

test('an unknown or missing visibility denies rather than allows', async () => {
  assert.equal(await canAccessStoredFile(record({ visibility: 'something_new' }), user(OTHER)), false);
  assert.equal(await canAccessStoredFile({ ownerId: OWNER }, user(OTHER)), false);
});

test('a public file is readable by anyone, including anonymously', async () => {
  const file = record({ visibility: 'public' });
  assert.equal(await canAccessStoredFile(file, user(OTHER)), true);
  assert.equal(await canAccessStoredFile(file, null), true);
});

test('the super-admin tier bypasses the policy', async () => {
  const file = record({ visibility: 'private' });
  assert.equal(await canAccessStoredFile(file, user(OTHER, { role: 'super_admin' })), true);
  assert.equal(await canAccessStoredFile(file, user(OTHER, { role: 'administrator' })), true);
  // ...but an ordinary admin role does NOT — it is not the super-admin tier.
  assert.equal(await canAccessStoredFile(file, user(OTHER, { role: 'admin' })), false);
});

test('role visibility admits only the listed roles', async () => {
  const file = record({ visibility: 'role', allowedRoles: ['faculty', 'admin'] });
  assert.equal(await canAccessStoredFile(file, user(OTHER, { role: 'faculty' })), true);
  assert.equal(await canAccessStoredFile(file, user(OTHER, { role: 'student' })), false);
  assert.equal(await canAccessStoredFile(file, null), false);
});

test('department visibility requires the same department', async () => {
  const file = record({ visibility: 'department', department: 'dept-cse' });
  assert.equal(await canAccessStoredFile(file, user(OTHER, { department: 'dept-cse' })), true);
  assert.equal(await canAccessStoredFile(file, user(OTHER, { department: 'dept-eee' })), false);
  assert.equal(await canAccessStoredFile(file, user(OTHER)), false);
});

test('batch visibility requires membership of one of the listed batches', async () => {
  const file = record({ visibility: 'batch', batches: ['batch-55', 'batch-56'] });
  assert.equal(await canAccessStoredFile(file, user(OTHER, { batch: 'batch-55' })), true);
  assert.equal(await canAccessStoredFile(file, user(OTHER, { batch: 'batch-56' })), true);
  assert.equal(await canAccessStoredFile(file, user(OTHER, { batch: 'batch-57' })), false);
  assert.equal(await canAccessStoredFile(file, user(OTHER)), false);
});

test('a department file with no department set is not a free pass', async () => {
  const file = record({ visibility: 'department', department: null });
  assert.equal(await canAccessStoredFile(file, user(OTHER, { department: 'dept-cse' })), false);
});

test('isOwner compares ids by value, not identity', () => {
  assert.equal(isOwner({ ownerId: 'abc' }, { _id: 'abc' }), true);
  assert.equal(isOwner({ ownerId: 'abc' }, { _id: 'abd' }), false);
  assert.equal(isOwner({ ownerId: 'abc' }, null), false);
});

test('assertCanAccess throws a 403 for a denied read', async () => {
  await assert.rejects(
    assertCanAccess(record({ visibility: 'private' }), user(OTHER)),
    (err) => {
      assert.equal(err.statusCode, 403);
      assert.equal(err.code, 'FORBIDDEN');
      return true;
    }
  );
  // And resolves for a permitted one.
  await assert.doesNotReject(assertCanAccess(record({ visibility: 'private' }), user(OWNER)));
});

test('mutating operations are owner-or-admin only', () => {
  const file = record();
  assert.doesNotThrow(() => assertOwnerOrAdmin(file, user(OWNER)));
  assert.doesNotThrow(() => assertOwnerOrAdmin(file, user(OTHER, { role: 'super_admin' })));
  assert.throws(() => assertOwnerOrAdmin(file, user(OTHER)), (err) => err.statusCode === 403);
  assert.throws(() => assertOwnerOrAdmin(file, null), (err) => err.statusCode === 403);
});
