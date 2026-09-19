import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { requiredStep, allowsApp, ACCESS } from './accessGate.js';

// The one gate that decides whether an account may use the protected screens.
// The server's nextStep is the authority; the raw emailVerified/approvalStatus
// fields are only the fallback for a cached record from before nextStep existed.
describe('requiredStep', () => {
  test('signed out is the public site', () => {
    assert.equal(requiredStep(null), ACCESS.READY);
    assert.equal(allowsApp(null), true);
  });

  test('the server nextStep is honoured', () => {
    assert.equal(requiredStep({ nextStep: 'EMAIL_VERIFICATION' }), ACCESS.EMAIL_VERIFICATION);
    assert.equal(requiredStep({ nextStep: 'STUDENT_ID_SUBMISSION' }), ACCESS.APPROVAL);
    assert.equal(requiredStep({ nextStep: 'WAITING_FOR_APPROVAL' }), ACCESS.APPROVAL);
    assert.equal(requiredStep({ nextStep: 'BLOCKED' }), ACCESS.BLOCKED);
    assert.equal(requiredStep({ nextStep: 'DASHBOARD' }), ACCESS.READY);
  });

  test('an unverified account falls back to verification', () => {
    assert.equal(requiredStep({ role: 'student', emailVerified: false }), ACCESS.EMAIL_VERIFICATION);
  });

  test('a verified but unapproved student falls back to approval', () => {
    assert.equal(
      requiredStep({ role: 'student', emailVerified: true, approvalStatus: 'pending' }),
      ACCESS.APPROVAL
    );
  });

  test('a verified approved student is ready', () => {
    assert.equal(
      requiredStep({ role: 'student', emailVerified: true, approvalStatus: 'approved' }),
      ACCESS.READY
    );
  });

  test('approval never holds a faculty or admin account', () => {
    assert.equal(requiredStep({ role: 'faculty', emailVerified: true }), ACCESS.READY);
    assert.equal(requiredStep({ role: 'admin', emailVerified: true }), ACCESS.READY);
  });

  test('an unapproved account is not allowed into the app', () => {
    assert.equal(allowsApp({ nextStep: 'WAITING_FOR_APPROVAL' }), false);
  });
});
