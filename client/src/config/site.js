// Central configuration for the public-facing Legal & Support pages.
//
// ── EDIT THIS FILE BEFORE RELEASE ───────────────────────────────────────────
// The project does NOT currently configure a public support/contact address
// anywhere (the only mail-related values in the project are the server-side
// EMAIL_FROM "no-reply" sender and the VAPID mailto: subject). Every value
// below is therefore a clearly-marked PLACEHOLDER that the university/admin
// must replace with real information. Nothing here is invented: a value left
// as a placeholder renders as a visible "[…]" marker on the page rather than
// a fake address, and `isPlaceholder()` is used by the UI to show an honest
// "not configured yet" note instead of pretending the details are real.
//
// You can override these at build time with Vite env vars (see .env.example):
//   VITE_SITE_URL, VITE_SUPPORT_EMAIL, VITE_PRIVACY_EMAIL,
//   VITE_UNIVERSITY_NAME, VITE_SITE_CONTACT_PHONE, VITE_SITE_CONTACT_ADDRESS
// ────────────────────────────────────────────────────────────────────────────

const env = import.meta.env;

const PLACEHOLDER_MARK = 'CONFIG PLACEHOLDER';

// Wraps a value so the UI can tell "the university filled this in" apart from
// "this is still the shipped placeholder". Never render `raw` directly without
// checking `isPlaceholder` first.
function placeholder(label, override) {
  const value = (override || '').trim();
  if (value) return { configured: true, value, label };
  return { configured: false, value: `[${label} — ${PLACEHOLDER_MARK}]`, label };
}

export function isPlaceholder(field) {
  return !field?.configured;
}

export const siteConfig = {
  appName: 'ISU Academic Portal',
  shortName: 'ISU Portal',

  // The university's own name/legal entity — replace with the official form.
  universityName: placeholder('University name', env.VITE_UNIVERSITY_NAME),

  // Public contact addresses. Support/help requests and privacy requests have
  // separate inboxes in most institutions; both fall back to the same
  // placeholder until configured.
  supportEmail: placeholder('Support email address', env.VITE_SUPPORT_EMAIL),
  privacyEmail: placeholder('Privacy contact email address', env.VITE_PRIVACY_EMAIL),
  legalEmail: placeholder('Legal/terms contact email address', env.VITE_LEGAL_EMAIL || env.VITE_SUPPORT_EMAIL),

  // Only shown if set — deliberately empty by default rather than invented.
  contactPhone: placeholder('Support phone number', env.VITE_SITE_CONTACT_PHONE),
  contactAddress: placeholder('University postal address', env.VITE_SITE_CONTACT_ADDRESS),

  // Support hours were never established anywhere in the project, so these are
  // intentionally blank. Set `supportHours` to a real string (e.g.
  // "Sunday–Thursday, 9:00–17:00") if the university publishes one.
  supportHours: (env.VITE_SUPPORT_HOURS || '').trim() || '',
  // Same for an explicit response-time promise — left blank so the page does
  // not make a commitment nobody agreed to.
  responseTime: (env.VITE_SUPPORT_RESPONSE_TIME || '').trim() || '',

  // The Android wrapper this web app is distributed inside (Google Play).
  // Confirmed from client/public/.well-known/assetlinks.json.
  androidPackageName: 'com.bluespacetech.isuacademicportal',

  // Policy version metadata. Bump `lastUpdated` whenever the copy changes.
  effectiveDate: 'September 16, 2026',
  lastUpdated: 'September 16, 2026',
  policyVersion: '1.0',
};

// The site's own public origin, used for canonical URLs. Falls back to the
// live browser origin (correct in production) and finally to a placeholder.
export function getSiteOrigin() {
  const configured = (env.VITE_SITE_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return 'https://your-portal-domain.edu';
}

export function isSiteUrlConfigured() {
  return !!(env.VITE_SITE_URL || '').trim();
}
