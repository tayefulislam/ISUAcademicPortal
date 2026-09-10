import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { connectTestDb, dropAndDisconnect, clearCollections } from '../test/dbTestUtils.js';
import User from '../models/User.js';
import Settings, { updateSettings } from '../models/Settings.js';
import { login, emailDomainMatches, isOfficialUniversityEmail, maybeAutoApproveStudent } from './authController.js';

// Exercises login() directly (not through Express/supertest) against a real,
// disposable local MongoDB — same convention as recipientResolver.test.js —
// since the whole point of this suite is the real identifier-lookup query
// (email/rollNo/phone, gated by the studentIdLoginEnabled/phoneLoginEnabled
// toggles), not a mocked one.
//
// asyncHandler wraps every controller as (req, res, next) =>
// Promise.resolve(fn(...)).catch(next) — so a thrown ApiError never rejects
// the call here, it's forwarded to `next`. callLogin() below captures
// whichever of {res.json, next(err)} actually fired.
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

async function callLogin(body) {
  const req = { body, ip: '127.0.0.1' };
  const res = fakeRes();
  let error;
  await login(req, res, (err) => {
    error = err;
  });
  return { res, error };
}

before(async () => {
  await connectTestDb('auth-login');
});

after(async () => {
  await dropAndDisconnect();
});

let student;

beforeEach(async () => {
  await clearCollections(User, Settings);
  // Both identifier toggles default ON (Settings.js's FEATURE_FLAGS
  // `default: true`) — getSettings()'s upsert-on-read below re-applies
  // those schema defaults since the Settings collection was just cleared.
  student = await User.create({
    name: 'Test Student',
    email: 'student@test.local',
    password: 'password123',
    role: 'student',
    rollNo: '1234567890123456',
    phone: '01712345678',
  });
});

describe('login — identifier resolution (email / rollNo / phone)', () => {
  test('signs in with email (case-insensitive) + correct password', async () => {
    const { res, error } = await callLogin({ identifier: 'STUDENT@test.local', password: 'password123' });
    assert.equal(error, undefined);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.user.email, 'student@test.local');
    assert.ok(res.body.data.token);
  });

  test('signs in with Student ID (rollNo) + correct password', async () => {
    const { res, error } = await callLogin({ identifier: '1234567890123456', password: 'password123' });
    assert.equal(error, undefined);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.user.rollNo, '1234567890123456');
  });

  test('signs in with phone number + correct password', async () => {
    const { res, error } = await callLogin({ identifier: '01712345678', password: 'password123' });
    assert.equal(error, undefined);
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.user.phone, '01712345678');
  });

  test('rejects a correct identifier with the wrong password', async () => {
    for (const identifier of ['student@test.local', '1234567890123456', '01712345678']) {
      const { error } = await callLogin({ identifier, password: 'wrong-password' });
      assert.equal(error?.statusCode, 401, `expected 401 for identifier "${identifier}"`);
    }
  });

  test('rejects an identifier that matches no user at all', async () => {
    const { error } = await callLogin({ identifier: 'nobody@nowhere.test', password: 'password123' });
    assert.equal(error?.statusCode, 401);
  });

  test('rejects a blocked account regardless of which identifier matched', async () => {
    await User.updateOne({ _id: student._id }, { status: 'blocked' });
    const { error } = await callLogin({ identifier: 'student@test.local', password: 'password123' });
    assert.equal(error?.statusCode, 403);
  });

  test('a bare identifier field with only whitespace never matches (guards against an empty-string rollNo/phone default)', async () => {
    // A second user with the schema's blank rollNo/phone defaults — proves
    // an all-whitespace identifier can't accidentally authenticate as them.
    await User.create({ name: 'No Roll Or Phone', email: 'blank@test.local', password: 'password123', role: 'student' });
    const { error } = await callLogin({ identifier: '   ', password: 'password123' });
    assert.equal(error?.statusCode, 401);
  });
});

describe('login — Super Admin identifier toggles (studentIdLoginEnabled / phoneLoginEnabled)', () => {
  test('rollNo login fails once studentIdLoginEnabled is turned off, even with the correct password', async () => {
    await updateSettings({ studentIdLoginEnabled: false });
    const { error } = await callLogin({ identifier: '1234567890123456', password: 'password123' });
    assert.equal(error?.statusCode, 401);
  });

  test('phone login fails once phoneLoginEnabled is turned off, even with the correct password', async () => {
    await updateSettings({ phoneLoginEnabled: false });
    const { error } = await callLogin({ identifier: '01712345678', password: 'password123' });
    assert.equal(error?.statusCode, 401);
  });

  test('email login is unaffected by either toggle being off', async () => {
    await updateSettings({ studentIdLoginEnabled: false, phoneLoginEnabled: false });
    const { res, error } = await callLogin({ identifier: 'student@test.local', password: 'password123' });
    assert.equal(error, undefined);
    assert.equal(res.body.success, true);
  });

  test('turning a toggle back ON immediately re-enables that identifier (no restart/caching)', async () => {
    await updateSettings({ studentIdLoginEnabled: false });
    assert.equal((await callLogin({ identifier: '1234567890123456', password: 'password123' })).error?.statusCode, 401);

    await updateSettings({ studentIdLoginEnabled: true });
    const { res, error } = await callLogin({ identifier: '1234567890123456', password: 'password123' });
    assert.equal(error, undefined);
    assert.equal(res.body.success, true);
  });

  test('both toggles OFF still allows email, but rejects rollNo and phone', async () => {
    await updateSettings({ studentIdLoginEnabled: false, phoneLoginEnabled: false });
    assert.equal((await callLogin({ identifier: '1234567890123456', password: 'password123' })).error?.statusCode, 401);
    assert.equal((await callLogin({ identifier: '01712345678', password: 'password123' })).error?.statusCode, 401);
    const emailAttempt = await callLogin({ identifier: 'student@test.local', password: 'password123' });
    assert.equal(emailAttempt.error, undefined);
  });
});

describe('emailDomainMatches — exact-domain matching (Automatic Student Approval)', () => {
  test('matches the configured domain, case-insensitively on both sides', () => {
    assert.equal(emailDomainMatches('student@isu.ac.bd', 'isu.ac.bd'), true);
    assert.equal(emailDomainMatches('Student@ISU.AC.BD', 'isu.ac.bd'), true);
    assert.equal(emailDomainMatches('student@isu.ac.bd', 'ISU.AC.BD'), true);
  });

  test('does NOT match a deceptive longer domain (no substring/suffix matching)', () => {
    assert.equal(emailDomainMatches('student@fakeisu.ac.bd', 'isu.ac.bd'), false);
  });

  test('does NOT match an unrelated domain', () => {
    assert.equal(emailDomainMatches('student@gmail.com', 'isu.ac.bd'), false);
  });

  test('does NOT match a subdomain unless it is exactly the configured value', () => {
    assert.equal(emailDomainMatches('student@mail.isu.ac.bd', 'isu.ac.bd'), false);
    // ...but it works fine if an admin explicitly configures the subdomain itself.
    assert.equal(emailDomainMatches('student@mail.isu.ac.bd', 'mail.isu.ac.bd'), true);
  });

  test('malformed input never matches (no "@", empty domain config)', () => {
    assert.equal(emailDomainMatches('not-an-email', 'isu.ac.bd'), false);
    assert.equal(emailDomainMatches('student@isu.ac.bd', ''), false);
    assert.equal(emailDomainMatches('', 'isu.ac.bd'), false);
  });
});

describe('isOfficialUniversityEmail — spec-named wrapper', () => {
  test('official domain -> true, gmail/yahoo -> false', () => {
    const settings = { studentAutoApprovalDomain: 'isu.ac.bd' };
    assert.equal(isOfficialUniversityEmail('student@isu.ac.bd', settings), true);
    assert.equal(isOfficialUniversityEmail('student@gmail.com', settings), false);
    assert.equal(isOfficialUniversityEmail('student@yahoo.com', settings), false);
  });
});

describe('maybeAutoApproveStudent — Automatic Student Approval (spec Part 1 / §24 test matrix)', () => {
  const mkPendingStudent = (overrides) =>
    User.create({
      name: 'X',
      email: `${Math.random().toString(36).slice(2)}@isu.ac.bd`,
      password: 'password123',
      role: 'student',
      approvalStatus: 'pending',
      emailVerified: false,
      approvalHistory: [{ action: 'SUBMITTED', performedBy: null, performedAt: new Date() }],
      ...overrides,
    });

  test('Case 1 — matching domain + OTP verified + feature ON -> APPROVED', async () => {
    const s = await mkPendingStudent({ email: 'student@isu.ac.bd', emailVerified: true });
    await maybeAutoApproveStudent(s, { studentAutoApprovalDomain: 'isu.ac.bd' }, {});
    assert.equal(s.approvalStatus, 'approved');
    assert.equal(s.approvalRole, 'system');
    assert.equal(s.approvedBy, null);
    assert.equal(s.approvalHistory.at(-1).action, 'AUTO_APPROVED');
  });

  test('Case 2 — non-university domain -> stays pending (normal manual workflow)', async () => {
    const s = await mkPendingStudent({ email: 'student@gmail.com', emailVerified: true });
    await maybeAutoApproveStudent(s, { studentAutoApprovalDomain: 'isu.ac.bd' }, {});
    assert.equal(s.approvalStatus, 'pending');
  });

  test('Case 3 — deceptive domain (fakeisu.ac.bd) -> NOT auto-approved', async () => {
    const s = await mkPendingStudent({ email: 'student@fakeisu.ac.bd', emailVerified: true });
    await maybeAutoApproveStudent(s, { studentAutoApprovalDomain: 'isu.ac.bd' }, {});
    assert.equal(s.approvalStatus, 'pending');
  });

  test('Case 4 — matching domain but OTP/email NOT verified -> NOT auto-approved', async () => {
    const s = await mkPendingStudent({ email: 'student@isu.ac.bd', emailVerified: false });
    await maybeAutoApproveStudent(s, { studentAutoApprovalDomain: 'isu.ac.bd' }, {});
    assert.equal(s.approvalStatus, 'pending');
  });

  test('Case 5 — mixed-case email + domain, OTP verified -> APPROVED', async () => {
    const s = await mkPendingStudent({ email: 'Student@ISU.AC.BD'.toLowerCase(), emailVerified: true });
    await maybeAutoApproveStudent(s, { studentAutoApprovalDomain: 'isu.ac.bd' }, {});
    assert.equal(s.approvalStatus, 'approved');
  });

  test('Case 6 — no configured domain at all -> NOT auto-approved (never a wildcard match)', async () => {
    const s = await mkPendingStudent({ email: 'student@isu.ac.bd', emailVerified: true });
    await maybeAutoApproveStudent(s, { studentAutoApprovalDomain: '' }, {});
    assert.equal(s.approvalStatus, 'pending');
  });

  test('unconditional whenever the general studentApprovalEnabled system is ON — there is no separate "enable auto-approval" toggle to forget (the actual bug this replaced)', async () => {
    const s = await mkPendingStudent({ email: 'student@isu.ac.bd', emailVerified: true });
    // Passing an object with no auto-approval-specific toggle at all (just
    // the domain) still approves — nothing else needs to be turned on.
    await maybeAutoApproveStudent(s, { studentAutoApprovalDomain: 'isu.ac.bd' }, {});
    assert.equal(s.approvalStatus, 'approved');
  });

  test('never touches a non-student role', async () => {
    const faculty = await User.create({
      name: 'F', email: 'faculty@isu.ac.bd', password: 'password123', role: 'faculty', approvalStatus: 'pending', emailVerified: true,
    });
    await maybeAutoApproveStudent(faculty, { studentAutoApprovalDomain: 'isu.ac.bd' }, {});
    assert.equal(faculty.approvalStatus, 'pending');
  });

  test('never re-processes an already-approved or already-rejected student (idempotent no-op)', async () => {
    const approved = await mkPendingStudent({ email: 'student@isu.ac.bd', emailVerified: true, approvalStatus: 'approved' });
    await maybeAutoApproveStudent(approved, { studentAutoApprovalDomain: 'isu.ac.bd' }, {});
    assert.equal(approved.approvalHistory.length, 1); // unchanged — the SUBMITTED entry from mkPendingStudent, no AUTO_APPROVED appended

    const rejected = await mkPendingStudent({ email: 'student2@isu.ac.bd', emailVerified: true, approvalStatus: 'rejected' });
    await maybeAutoApproveStudent(rejected, { studentAutoApprovalDomain: 'isu.ac.bd' }, {});
    assert.equal(rejected.approvalStatus, 'rejected');
  });

  test('clears any stale rejectionReason on auto-approval (e.g. after a resubmission)', async () => {
    const s = await mkPendingStudent({ email: 'student@isu.ac.bd', emailVerified: true, rejectionReason: 'old reason' });
    await maybeAutoApproveStudent(s, { studentAutoApprovalDomain: 'isu.ac.bd' }, {});
    assert.equal(s.rejectionReason, '');
  });
});
