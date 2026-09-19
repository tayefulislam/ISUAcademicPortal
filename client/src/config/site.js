// Central configuration for the public-facing Legal & Support pages.
//
// ── CONTACT DETAILS ─────────────────────────────────────────────────────────
// The public contact addresses are set below as defaults, so the Legal &
// Support pages — including the privacy policy Google Play requires — are
// complete without any build configuration. A Vite env var (see .env.example)
// still overrides each one, for a deployment that needs different values:
//   VITE_SITE_URL, VITE_SUPPORT_EMAIL, VITE_PRIVACY_EMAIL, VITE_LEGAL_EMAIL,
//   VITE_UNIVERSITY_NAME, VITE_SITE_CONTACT_PHONE, VITE_SITE_CONTACT_ADDRESS
//
// Anything deliberately left unset (the postal address and phone number, which
// the university has not supplied) still renders as a visible "[…]" marker and
// an honest "not configured yet" note, rather than an invented address.
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

  // How the portal names itself on the legal pages.
  universityName: placeholder('University name', env.VITE_UNIVERSITY_NAME || 'ISU Academic Portal'),

  // Public contact addresses. Support/help requests and privacy requests have
  // separate inboxes: portal support on the one hand, and the contact a data
  // request (including account deletion) should go to on the other.
  supportEmail: placeholder('Support email address', env.VITE_SUPPORT_EMAIL || 'hello@tayeful.com'),
  privacyEmail: placeholder('Privacy contact email address', env.VITE_PRIVACY_EMAIL || 'isu@tayeful.com'),
  legalEmail: placeholder(
    'Legal/terms contact email address',
    env.VITE_LEGAL_EMAIL || env.VITE_SUPPORT_EMAIL || 'hello@tayeful.com'
  ),

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
  const configured = (env.VITE_SITE_URL || 'https://isu-academic-portal.vercel.app').trim().replace(/\/$/, '');
  if (configured) return configured;
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return 'https://your-portal-domain.edu';
}

export function isSiteUrlConfigured() {
  return !!(env.VITE_SITE_URL || '').trim();
}
