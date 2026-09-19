// The one decision of whether an account may use the app's protected screens,
// and what it still has to do first. The Android app mirrors this in AccessGate.
//
// The authority is the server's `nextStep` (services/registrationFlowService.js),
// which is already derived from exactly the two facts the rule names —
// emailVerified and approvalStatus — plus the settings that decide whether either
// step even applies to this deployment (OTP verification, student approval) and
// the account's role. Re-deriving it from the raw fields is only the fallback for
// a cached user from before nextStep existed.
export const ACCESS = Object.freeze({
  READY: 'READY',
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  APPROVAL: 'APPROVAL',
  BLOCKED: 'BLOCKED',
});

/** Where each unmet requirement is answered. */
export const ACCESS_PATH = {
  [ACCESS.EMAIL_VERIFICATION]: '/verify-otp',
  [ACCESS.APPROVAL]: '/pending-approval',
  [ACCESS.BLOCKED]: '/403',
};

export function requiredStep(user) {
  if (!user) return ACCESS.READY; // signed out — the public site

  switch (user.nextStep) {
    case 'EMAIL_VERIFICATION':
      return ACCESS.EMAIL_VERIFICATION;
    case 'STUDENT_ID_SUBMISSION':
    case 'WAITING_FOR_APPROVAL':
      return ACCESS.APPROVAL;
    case 'BLOCKED':
      return ACCESS.BLOCKED;
    case 'DASHBOARD':
      return ACCESS.READY;
    default:
      break;
  }

  // No nextStep on the cached record: fall back to the raw facts.
  if (user.emailVerified !== true) return ACCESS.EMAIL_VERIFICATION;
  if (user.role === 'student' && user.approvalStatus !== 'approved') return ACCESS.APPROVAL;
  return ACCESS.READY;
}

export function allowsApp(user) {
  return requiredStep(user) === ACCESS.READY;
}
