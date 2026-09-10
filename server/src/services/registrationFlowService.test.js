import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getNextRequiredStep, NEXT_STEP, isOfficialUniversityEmail, emailDomainMatches } from './registrationFlowService.js';

// Pure-function tests (no database needed) — this is the single source of
// truth every page/endpoint uses to route a student through registration
// (login(), verifyOtp(), register() in authController.js; Dashboard.jsx and
// PendingApproval.jsx on the frontend). Exhaustively covers the OTP ON/OFF x
// Student-ID ON/OFF x approval-state matrix from the spec.

function mkUser(overrides) {
  return {
    role: 'student',
    status: 'active',
    emailVerified: true,
    approvalStatus: 'approved',
    studentIdImage: null,
    ...overrides,
  };
}

describe('getNextRequiredStep — non-student roles always pass straight through', () => {
  for (const role of ['faculty', 'admin', 'administrator', 'super_admin', 'cr']) {
    test(`role "${role}" -> DASHBOARD regardless of settings`, () => {
      const user = mkUser({ role, status: 'blocked', emailVerified: false, approvalStatus: 'pending' });
      const settings = { otpVerificationEnabled: true, studentApprovalEnabled: true };
      assert.equal(getNextRequiredStep(user, settings), NEXT_STEP.DASHBOARD);
    });
  }

  test('no user at all -> DASHBOARD (nothing to gate)', () => {
    assert.equal(getNextRequiredStep(null, { otpVerificationEnabled: true, studentApprovalEnabled: true }), NEXT_STEP.DASHBOARD);
  });
});

describe('getNextRequiredStep — blocked status always wins first', () => {
  test('a blocked student -> BLOCKED even with a verified email and an approved Student ID', () => {
    const user = mkUser({ status: 'blocked', emailVerified: true, approvalStatus: 'approved' });
    const settings = { otpVerificationEnabled: true, studentApprovalEnabled: true };
    assert.equal(getNextRequiredStep(user, settings), NEXT_STEP.BLOCKED);
  });

  test('a blocked student -> BLOCKED, not EMAIL_VERIFICATION, even with an unverified email', () => {
    const user = mkUser({ status: 'blocked', emailVerified: false });
    const settings = { otpVerificationEnabled: true, studentApprovalEnabled: true };
    assert.equal(getNextRequiredStep(user, settings), NEXT_STEP.BLOCKED);
  });
});

describe('getNextRequiredStep — OTP ON + Student ID ON', () => {
  const settings = { otpVerificationEnabled: true, studentApprovalEnabled: true };

  test('email not verified -> EMAIL_VERIFICATION (before Student ID is even considered)', () => {
    const user = mkUser({ emailVerified: false, approvalStatus: 'approved' });
    assert.equal(getNextRequiredStep(user, settings), NEXT_STEP.EMAIL_VERIFICATION);
  });

  test('verified + approved (official-email auto-approval already applied) -> DASHBOARD', () => {
    const user = mkUser({ emailVerified: true, approvalStatus: 'approved' });
    assert.equal(getNextRequiredStep(user, settings), NEXT_STEP.DASHBOARD);
  });

  test('verified + pending + no Student ID submitted yet -> STUDENT_ID_SUBMISSION', () => {
    const user = mkUser({ emailVerified: true, approvalStatus: 'pending', studentIdImage: null });
    assert.equal(getNextRequiredStep(user, settings), NEXT_STEP.STUDENT_ID_SUBMISSION);
  });

  test('verified + pending + Student ID already submitted -> WAITING_FOR_APPROVAL', () => {
    const user = mkUser({ emailVerified: true, approvalStatus: 'pending', studentIdImage: { provider: 's3' } });
    assert.equal(getNextRequiredStep(user, settings), NEXT_STEP.WAITING_FOR_APPROVAL);
  });

  test('verified + rejected -> STUDENT_ID_SUBMISSION (resubmission), regardless of whether an old photo is still on file', () => {
    const user = mkUser({ emailVerified: true, approvalStatus: 'rejected', studentIdImage: { provider: 's3' } });
    assert.equal(getNextRequiredStep(user, settings), NEXT_STEP.STUDENT_ID_SUBMISSION);
  });
});

describe('getNextRequiredStep — OTP ON + Student ID OFF', () => {
  const settings = { otpVerificationEnabled: true, studentApprovalEnabled: false };

  test('email not verified -> EMAIL_VERIFICATION', () => {
    const user = mkUser({ emailVerified: false });
    assert.equal(getNextRequiredStep(user, settings), NEXT_STEP.EMAIL_VERIFICATION);
  });

  test('email verified -> DASHBOARD immediately, even if approvalStatus is somehow still "pending"', () => {
    const user = mkUser({ emailVerified: true, approvalStatus: 'pending' });
    assert.equal(getNextRequiredStep(user, settings), NEXT_STEP.DASHBOARD);
  });
});

describe('getNextRequiredStep — OTP OFF + Student ID ON', () => {
  const settings = { otpVerificationEnabled: false, studentApprovalEnabled: true };

  test('never routes to EMAIL_VERIFICATION when OTP is disabled, even with emailVerified: false', () => {
    const user = mkUser({ emailVerified: false, approvalStatus: 'pending', studentIdImage: null });
    assert.equal(getNextRequiredStep(user, settings), NEXT_STEP.STUDENT_ID_SUBMISSION);
  });

  test('pending + submitted -> WAITING_FOR_APPROVAL', () => {
    const user = mkUser({ emailVerified: false, approvalStatus: 'pending', studentIdImage: { provider: 'imgbb' } });
    assert.equal(getNextRequiredStep(user, settings), NEXT_STEP.WAITING_FOR_APPROVAL);
  });

  test('approved -> DASHBOARD', () => {
    const user = mkUser({ emailVerified: false, approvalStatus: 'approved' });
    assert.equal(getNextRequiredStep(user, settings), NEXT_STEP.DASHBOARD);
  });
});

describe('getNextRequiredStep — OTP OFF + Student ID OFF', () => {
  const settings = { otpVerificationEnabled: false, studentApprovalEnabled: false };

  test('always DASHBOARD immediately, no verification page of any kind', () => {
    const user = mkUser({ emailVerified: false, approvalStatus: 'pending', studentIdImage: null });
    assert.equal(getNextRequiredStep(user, settings), NEXT_STEP.DASHBOARD);
  });
});

describe('emailDomainMatches / isOfficialUniversityEmail — exact-domain matching', () => {
  test('exact match only, no substring/suffix or subdomain matching', () => {
    assert.equal(emailDomainMatches('a@isu.ac.bd', 'isu.ac.bd'), true);
    assert.equal(emailDomainMatches('a@fakeisu.ac.bd', 'isu.ac.bd'), false);
    assert.equal(emailDomainMatches('a@mail.isu.ac.bd', 'isu.ac.bd'), false);
  });

  test('isOfficialUniversityEmail matches across a list of configured domains', () => {
    const settings = { officialEmailDomains: ['isu.ac.bd', 'isu-grad.ac.bd'] };
    assert.equal(isOfficialUniversityEmail('a@isu.ac.bd', settings), true);
    assert.equal(isOfficialUniversityEmail('a@isu-grad.ac.bd', settings), true);
    assert.equal(isOfficialUniversityEmail('a@gmail.com', settings), false);
  });
});
