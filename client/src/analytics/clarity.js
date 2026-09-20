import Clarity from '@microsoft/clarity';

/**
 * Microsoft Clarity — the single place the web client talks to Clarity.
 *
 * Clarity gives us session recordings, heatmaps, click/navigation behaviour
 * and (where the browser supports it) error signals. Everything here is
 * best-effort: analytics must never throw, never block rendering, and never
 * prevent login, API calls, navigation or any other feature from working.
 *
 * Clarity starts as soon as the app loads (no prompt, no gate). Sensitive
 * fields are masked and no personal data is ever sent — see below.
 *
 * Configuration (Vite inlines these at build time):
 *   VITE_CLARITY_ENABLED     "false" disables Clarity for this build
 *   VITE_CLARITY_PROJECT_ID  the Clarity project ID (required to run)
 *
 * This module deliberately sits beside (and does not touch) utils/analytics.js,
 * which owns Google Analytics 4 — the two never depend on each other.
 */

const RAW_PROJECT_ID = import.meta.env.VITE_CLARITY_PROJECT_ID;
const PROJECT_ID = typeof RAW_PROJECT_ID === 'string' ? RAW_PROJECT_ID.trim() : '';

// Set VITE_CLARITY_ENABLED=false to keep an environment (e.g. local dev) fully
// off without having to remove the project ID. Anything other than an explicit
// "false" leaves it enabled.
const ENABLED =
  String(import.meta.env.VITE_CLARITY_ENABLED ?? 'true').trim().toLowerCase() !== 'false';

const GUEST_ID = 'guest';

let initialized = false;

function isBrowser() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * True when Clarity is switched on for this build and a project ID is present.
 * An unconfigured build never loads Clarity or warns beyond a development-only
 * hint.
 */
export function isClarityConfigured() {
  return isBrowser() && ENABLED && PROJECT_ID.length > 0;
}

/**
 * Initializes Clarity exactly once. Returns true when Clarity is (or already
 * was) active. Never throws.
 */
export function initClarity() {
  if (initialized) return true;
  if (!isClarityConfigured()) {
    if (ENABLED && PROJECT_ID.length === 0 && import.meta.env.DEV) {
      console.warn('[clarity] VITE_CLARITY_PROJECT_ID is not set — Microsoft Clarity is disabled.');
    }
    return false;
  }

  // Set before the call so React StrictMode's double-invoked effects (and any
  // re-render) can never inject the script twice.
  initialized = true;
  try {
    Clarity.init(PROJECT_ID);
    // No consent gate: signal that the cookie may be set so recording starts.
    Clarity.consent(true);
    // Tag the landing page straight away: the route tracker has not run yet.
    Clarity.setTag('page', clarityScreenName(window.location.pathname));
    return true;
  } catch (error) {
    initialized = false;
    if (import.meta.env.DEV) console.warn('[clarity] initialization failed', error);
    return false;
  }
}

/**
 * Associates the current session with an internal, non-sensitive user ID.
 * Callers must pass an opaque backend id (the Mongo user _id) — never a name,
 * email, Student ID, phone number or any other personal value.
 */
export function identifyClarityUser(internalUserId) {
  if (!initialized || !internalUserId) return;
  try {
    Clarity.identify(`user_${internalUserId}`);
  } catch {
    // Ignore — identity is advisory telemetry.
  }
}

/** Labels the session as anonymous after sign-out or while browsing signed out. */
export function identifyClarityGuest() {
  if (!initialized) return;
  try {
    Clarity.identify(GUEST_ID);
  } catch {
    // Ignore.
  }
}

/** Attaches a non-sensitive custom tag (filterable in the Clarity dashboard). */
export function setClarityTag(key, value) {
  if (!initialized || !key || value === undefined || value === null || value === '') return;
  try {
    Clarity.setTag(String(key), String(value));
  } catch {
    // Ignore.
  }
}

/** Records a non-sensitive custom event. Never pass personal content. */
export function trackClarityEvent(name) {
  if (!initialized || !name) return;
  try {
    Clarity.event(String(name));
  } catch {
    // Ignore.
  }
}

/**
 * Normalizes a router path into a stable, low-cardinality screen name so
 * dynamic ids (`/courses/64f...`) don't explode the dashboard's page list.
 */
export function clarityScreenName(pathname) {
  if (!pathname || pathname === '/') return 'home';
  const clean = pathname.split('?')[0].replace(/\/+$/, '') || '/';

  if (/^\/files\/[^/]+$/.test(clean)) return 'file_details';
  if (/^\/courses\/[^/]+$/.test(clean)) return 'course';
  if (/^\/quizzes\/[^/]+\/attempt\/[^/]+$/.test(clean)) return 'quiz_attempt';
  if (/^\/quizzes\/[^/]+\/result\/[^/]+$/.test(clean)) return 'quiz_result';
  if (/^\/student\/results\/[^/]+$/.test(clean)) return 'quiz_result';
  if (/^\/exam\/[^/]+\/attempt\/[^/]+$/.test(clean)) return 'public_exam_attempt';
  if (/^\/exam\/[^/]+\/result\/[^/]+$/.test(clean)) return 'public_exam_result';
  if (/^\/exam\/[^/]+$/.test(clean)) return 'public_exam';
  if (/^\/applications\/[^/]+$/.test(clean)) return 'application_detail';
  if (/^\/documents\/[^/]+$/.test(clean)) return 'document_detail';

  return clean.replace(/^\/+/, '').replace(/\//g, '_');
}

/**
 * Called from the app's single route tracker. Tags the current page and keeps
 * the Clarity identity in step with the auth state, so a previous user's
 * identity is never left on the session after sign-out or an account switch.
 */
export function trackClarityRoute(pathname, user) {
  if (!initialized) return;
  setClarityTag('page', clarityScreenName(pathname));
  if (user && user._id) {
    identifyClarityUser(user._id);
    if (user.role) setClarityTag('role', user.role);
  } else {
    identifyClarityGuest();
  }
}
