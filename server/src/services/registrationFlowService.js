// Centralized registration/verification decision logic — the single place
// that answers "what does this student still need to do before they can
// reach the dashboard?" Every place that used to re-derive this from raw
// user/settings fields (Dashboard.jsx's redirect, PendingApproval.jsx's
// sub-state, login()/verifyOtp()'s response) asks getNextRequiredStep()
// instead, so the decision can never drift between two call sites.
//
// Deliberately reused (not duplicated) by authController.js — see that
// file's re-exports of emailDomainMatches/isOfficialUniversityEmail, kept
// for any existing import site (including tests) that still imports them
// from there.

export const NEXT_STEP = Object.freeze({
  BLOCKED: 'BLOCKED',
  EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
  STUDENT_ID_SUBMISSION: 'STUDENT_ID_SUBMISSION',
  WAITING_FOR_APPROVAL: 'WAITING_FOR_APPROVAL',
  DASHBOARD: 'DASHBOARD',
});

// Exact-domain match only — deliberately NOT `.endsWith()`/`.includes()`,
// which would let "student@fakeisu.ac.bd" match a configured "isu.ac.bd"
// (string suffix match), and deliberately NOT satisfied by a subdomain like
// "mail.isu.ac.bd" unless an admin explicitly configures that exact string
// as one of the official domains. Both sides are lowercased/trimmed (the
// User email is already lowercase on save; Settings.officialEmailDomains
// entries are normalized on write — see Settings.js's normalizeDomain) so
// this only needs a straight equality check.
export function emailDomainMatches(email, configuredDomain) {
  if (!configuredDomain) return false;
  const at = String(email || '').lastIndexOf('@');
  if (at === -1) return false;
  const domain = email.slice(at + 1).toLowerCase();
  return domain === configuredDomain.toLowerCase();
}

// True if `email` ends in ANY of the admin-configured official domains
// (Settings.officialEmailDomains — a list, so a university can register
// more than one accepted domain). Reads the configured list from
// server-side Settings, never from anything client-supplied.
export function isOfficialUniversityEmail(email, settings) {
  const domains = settings?.officialEmailDomains || [];
  return domains.some((domain) => emailDomainMatches(email, domain));
}

// The single source of truth for routing a student through registration.
// Every condition reads only from the DATABASE user record and server-side
// Settings — never anything client-supplied. Non-student roles (faculty,
// admin-tier, super_admin) always resolve to DASHBOARD; this whole workflow
// only ever applied to students.
//
// Mirrors the exact decision tree:
//   blocked?              -> BLOCKED
//   OTP required + not verified? -> EMAIL_VERIFICATION
//   Student ID not required at all? -> DASHBOARD
//   already approved? (covers auto-approval by official domain, which
//     authController.js's maybeAutoApproveStudent already wrote into
//     approvalStatus the moment email verification succeeded — this
//     function trusts that stored result rather than re-deriving the
//     domain match itself, so the two can never disagree) -> DASHBOARD
//   rejected?              -> STUDENT_ID_SUBMISSION (resubmission)
//   pending, no photo on file yet? -> STUDENT_ID_SUBMISSION (first submission)
//   pending, photo already submitted? -> WAITING_FOR_APPROVAL
export function getNextRequiredStep(user, settings) {
  if (!user || user.role !== 'student') return NEXT_STEP.DASHBOARD;
  if (user.status === 'blocked') return NEXT_STEP.BLOCKED;

  const otpRequired = !!settings?.otpVerificationEnabled;
  if (otpRequired && !user.emailVerified) return NEXT_STEP.EMAIL_VERIFICATION;

  if (!settings?.studentApprovalEnabled) return NEXT_STEP.DASHBOARD;

  if (user.approvalStatus === 'approved') return NEXT_STEP.DASHBOARD;
  if (user.approvalStatus === 'rejected') return NEXT_STEP.STUDENT_ID_SUBMISSION;

  // 'pending' (or the legacy 'blocked' approvalStatus value, treated the
  // same as pending here — that value is not part of this workflow's own
  // vocabulary and nothing in the app currently sets it).
  return user.studentIdImage?.provider ? NEXT_STEP.WAITING_FOR_APPROVAL : NEXT_STEP.STUDENT_ID_SUBMISSION;
}
