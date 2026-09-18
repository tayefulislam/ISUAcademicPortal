// Shared vocabulary + derivations for class routine entries and academic
// events, so the models, the audience filter, the calendar service and the
// reminder engine all agree on what a status means.

// The fine-grained kind of a scheduled slot. Deliberately one list covering
// teaching and assessment: the spec keeps `classType` and `eventType` separate
// concepts, and this is the `classType` half.
export const CLASS_TYPES = [
  'REGULAR',
  'LAB',
  'CT',
  'MID_TERM',
  'FINAL',
  'QUIZ',
  'PRESENTATION',
  'ASSIGNMENT_DEADLINE',
  'OTHER',
];

// The coarse bucket used for grouping/filtering and for choosing a calendar
// icon — the `eventType` half. Derived from classType, never sent by clients,
// so the two can never disagree.
export const EVENT_TYPES = ['CLASS', 'EXAM', 'DEADLINE', 'EVENT'];

export const DELIVERY_MODES = ['OFFLINE', 'ONLINE', 'HYBRID'];

// Per-occurrence state. A cancelled or rescheduled date is an exception
// recorded on the instance, which is what lets one occurrence change without
// touching the recurring template behind it.
export const INSTANCE_STATUSES = ['NORMAL', 'CANCELLED', 'RESCHEDULED', 'SPECIAL'];

// The states a client renders, computed from the times rather than stored —
// "in progress" is a fact about now, not something a write should decide.
export const EVENT_STATES = ['UPCOMING', 'STARTING_SOON', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];

const EXAM_CLASS_TYPES = new Set(['CT', 'MID_TERM', 'FINAL', 'QUIZ']);
const DEADLINE_CLASS_TYPES = new Set(['ASSIGNMENT_DEADLINE']);

/** The coarse eventType for a classType — see EVENT_TYPES above. */
export function eventTypeForClassType(classType) {
  if (classType === 'REGULAR' || classType === 'LAB') return 'CLASS';
  if (EXAM_CLASS_TYPES.has(classType)) return 'EXAM';
  if (DEADLINE_CLASS_TYPES.has(classType)) return 'DEADLINE';
  return 'EVENT';
}

/** How long before the start an event reads as "starting soon". */
export const STARTING_SOON_MINUTES = 15;

/**
 * The display state of one occurrence at a given instant. Cancelled wins over
 * everything — a cancelled class must never read as in progress.
 */
export function eventStateFor({ status, startAt, endAt }, now = new Date()) {
  if (status === 'CANCELLED') return 'CANCELLED';
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  const at = now.getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 'UPCOMING';
  if (at >= end) return 'COMPLETED';
  if (at >= start) return 'IN_PROGRESS';
  if (start - at <= STARTING_SOON_MINUTES * 60 * 1000) return 'STARTING_SOON';
  return 'UPCOMING';
}

/** A slot that should be shown as the user's live/next event. */
export function isActiveEvent(status) {
  return status !== 'CANCELLED';
}
