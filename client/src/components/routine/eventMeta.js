import { BookOpen, ClipboardList, AlarmClock, CalendarDays, FlaskConical } from 'lucide-react';

// Shared vocabulary for the routine and calendar UI.
//
// The server returns one normalised shape for both a class occurrence and an
// academic event (AcademicEventService.toView), and it deliberately computes
// `state` at the moment of the request. That is fine for a static list, but the
// widget has to flip from UPCOMING to IN_PROGRESS to COMPLETED on its own
// without re-fetching (spec §13), so the same rules are mirrored here — they
// must stay in step with server/src/utils/academicEventTypes.js.

export const EVENT_ICONS = {
  CLASS: BookOpen,
  EXAM: ClipboardList,
  DEADLINE: AlarmClock,
  EVENT: CalendarDays,
};

export const CLASS_TYPE_LABELS = {
  REGULAR: 'Class',
  LAB: 'Lab',
  CT: 'CT',
  MID_TERM: 'Mid Term',
  FINAL: 'Final',
  QUIZ: 'Quiz',
  PRESENTATION: 'Presentation',
  ASSIGNMENT_DEADLINE: 'Deadline',
  OTHER: 'Event',
};

export const MODE_LABELS = {
  OFFLINE: 'Offline',
  ONLINE: 'Online',
  HYBRID: 'Hybrid',
};

/** How long before the start an event reads as "starting soon" (server: 15). */
export const STARTING_SOON_MS = 15 * 60 * 1000;

export function eventIcon(event) {
  if (!event) return CalendarDays;
  // A lab is a class, but it deserves its own glyph — it is the one class type
  // students routinely have to walk somewhere else for.
  if (event.classType === 'LAB') return FlaskConical;
  return EVENT_ICONS[event.eventType] || CalendarDays;
}

/** The specific kind ("Lab", "Mid Term", "Class") — never just "event". */
export function typeLabel(event) {
  if (!event) return '';
  return CLASS_TYPE_LABELS[event.classType] || 'Event';
}

/** The course code if there is one, otherwise the event's own title. */
export function eventTitle(event) {
  if (!event) return '';
  return event.course?.code || event.title || 'Class';
}

export function eventSubtitle(event) {
  if (!event) return '';
  return event.course?.name || (event.course ? '' : event.title || '');
}

/**
 * "13:00" -> "01:00 PM".
 *
 * The server stores and sends a timetable in 24-hour wall-clock, which is how it
 * is entered and how it sorts; people read it in 12-hour form. Midnight is
 * 12:00 AM and noon is 12:00 PM — the off-by-twelve a bare `hour % 12` gets
 * wrong. Anything that is not already `H:mm` is passed through untouched.
 */
export function clock(value) {
  const raw = String(value ?? '').trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return raw;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return raw;
  const suffix = hour < 12 ? 'AM' : 'PM';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(twelve).padStart(2, '0')}:${match[2]} ${suffix}`;
}

export function timeRange(event) {
  if (!event) return '';
  const from = clock(event.startTime);
  const to = clock(event.endTime);
  if (!from) return to;
  if (!to) return from;
  return `${from} – ${to}`;
}

export function hasOnline(event) {
  return Boolean(event && (event.mode === 'ONLINE' || event.mode === 'HYBRID'));
}

export function locationLine(event) {
  if (!event) return '';
  if (event.mode === 'ONLINE') return 'Online';
  if (event.mode === 'HYBRID') return `Room ${event.room} · Online`;
  return event.room ? `Room ${event.room}` : 'Room TBA';
}

/**
 * The display state at a given instant — the client-side mirror of the server's
 * eventStateFor, so the widget can transition without another request.
 */
export function eventState(event, nowMs) {
  if (!event) return null;
  if (event.status === 'CANCELLED') return 'CANCELLED';
  const start = new Date(event.startAt).getTime();
  const end = new Date(event.endAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 'UPCOMING';
  if (nowMs >= end) return 'COMPLETED';
  if (nowMs >= start) return 'IN_PROGRESS';
  if (start - nowMs <= STARTING_SOON_MS) return 'STARTING_SOON';
  return 'UPCOMING';
}

/** 0–100, clamped — the progress bar for an in-progress event. */
export function progressPercent(event, nowMs) {
  if (!event) return 0;
  const start = new Date(event.startAt).getTime();
  const end = new Date(event.endAt).getTime();
  if (!(end > start)) return 0;
  const pct = ((nowMs - start) / (end - start)) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * A human gap: "2h 05m" / "37 min" / "4m 20s" / "42s".
 * Precise to the minute while there is time to spare, and to the second in the
 * last minute, where a countdown is the whole point.
 */
export function formatGap(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 1) return `${minutes} min`;
  if (minutes === 1) return `1 min ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/** "Starts in 37 min" / "42 min remaining" / "Ends in 00:42". */
export function countdownLabel(event, nowMs, state) {
  if (!event) return '';
  const start = new Date(event.startAt).getTime();
  const end = new Date(event.endAt).getTime();

  if (state === 'IN_PROGRESS') {
    const left = end - nowMs;
    if (left <= 60_000) return `Ends in ${String(Math.max(0, Math.floor(left / 1000))).padStart(2, '0')}s`;
    return `${formatGap(left)} remaining`;
  }
  if (state === 'STARTING_SOON') return `Starting in ${formatGap(start - nowMs)}`;
  if (state === 'UPCOMING') return `Starts in ${formatGap(start - nowMs)}`;
  return '';
}

/** "Today", "Tomorrow", or a short date — used where a day heading is needed. */
export function dayLabel(dateStr, todayStr, tomorrowStr) {
  if (!dateStr) return '';
  if (dateStr === todayStr) return 'Today';
  if (dateStr === tomorrowStr) return 'Tomorrow';
  const d = new Date(`${dateStr}T00:00:00+06:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { timeZone: 'Asia/Dhaka', weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * The Dhaka calendar date for an instant — the client mirror of the server's
 * dhakaDateString. Bangladesh is a fixed +06:00, so shifting the epoch and
 * reading the UTC date is exact and needs no timezone database.
 */
export function dhakaDate(ms = Date.now()) {
  return new Date(ms + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Clock time ("10:00") for an instant, in Dhaka. */
export function dhakaClock(iso) {
  if (!iso) return '';
  return new Date(new Date(iso).getTime() + 6 * 60 * 60 * 1000).toISOString().slice(11, 16);
}
