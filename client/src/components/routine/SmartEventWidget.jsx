import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  MapPin, User as UserIcon, Users, Video, CalendarDays, ChevronDown, ChevronUp, X, CalendarOff,
} from 'lucide-react';
import { routineApi } from '../../api/endpoints.js';
import {
  eventState, eventTitle, eventSubtitle, typeLabel, timeRange, hasOnline, locationLine,
  progressPercent, countdownLabel, formatGap, eventIcon, dhakaDate,
} from './eventMeta.js';

// The Smart Academic Event Widget — one component, four placements (spec §7).
//
// It is the only place that answers "what's on now / next", and it does so from
// a single server call, then counts down locally. Two details make it correct
// rather than approximately correct:
//
//  * `serverTime` from the response is used to derive a clock skew against the
//    device clock, so a phone set five minutes fast still shows the official
//    countdown. Times are absolute instants from the server, never re-derived
//    from the browser's timezone.
//  * the widget re-fetches at the exact moment an event is due to start or end,
//    not on a timer — a class flipping to IN_PROGRESS is a transition the user
//    is watching for, and polling every second to catch it would be wasteful.

const STORAGE_HIDDEN = 'routine-widget-hidden';
const STORAGE_MINIMIZED = 'routine-widget-minimized';

/** A local ticking clock, at a cadence matched to how close the next change is. */
function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Under 90 minutes away → tick each second; further out, once every 30s. */
function tickIntervalFor(events) {
  const soonest = events
    .filter(Boolean)
    .flatMap((e) => [new Date(e.startAt).getTime(), new Date(e.endAt).getTime()])
    .filter((t) => t > Date.now())
    .sort((a, b) => a - b)[0];
  if (!soonest) return 30_000;
  return soonest - Date.now() < 90 * 60 * 1000 ? 1000 : 30_000;
}

export function useCurrentNext() {
  const query = useQuery({
    queryKey: ['routine', 'current-next'],
    queryFn: routineApi.currentNext,
    // A slow backstop only. The precise refresh is the boundary timer below —
    // the spec is explicit that this must not become a per-second poll.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const payload = query.data?.data || null;
  // Signed difference between the institution's clock and this device's.
  const skew = useMemo(() => {
    if (!payload?.serverTime) return 0;
    return new Date(payload.serverTime).getTime() - Date.now();
    // Recomputed on every fetch, which is the point — a device clock that drifts
    // is corrected the next time we ask.
  }, [payload?.serverTime]);

  return { ...query, payload, skew };
}

/**
 * @param {{mode?: 'dashboard'|'compact'|'floating', className?: string}} props
 */
export default function SmartEventWidget({ mode = 'dashboard', className = '' }) {
  const navigate = useNavigate();
  const { payload, skew, isLoading, isError, refetch } = useCurrentNext();

  const current = payload?.current || null;
  const next = payload?.next || null;
  const hasAnySchedule = payload?.hasAnySchedule;

  const tickMs = useMemo(() => tickIntervalFor([current, next]), [current, next]);
  const localNow = useNow(tickMs);
  const nowMs = localNow + skew;

  // The next moment the picture changes: this class ending, or the next one
  // starting. Keyed on the event identities, not on `now`, so the timer is set
  // once per boundary rather than being re-armed every tick.
  const boundary = useMemo(() => {
    const candidates = [];
    if (current) candidates.push(new Date(current.endAt).getTime());
    if (next) candidates.push(new Date(next.startAt).getTime());
    return candidates.filter((t) => t > Date.now() + skew).sort((a, b) => a - b)[0] || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, current?.endAt, next?.id, next?.startAt]);

  useEffect(() => {
    if (!boundary) return undefined;
    // +2s so the server's own state has also moved on when we ask again.
    const delay = Math.max(1000, boundary - (Date.now() + skew) + 2000);
    const id = setTimeout(() => refetch(), delay);
    return () => clearTimeout(id);
  }, [boundary, refetch, skew]);

  const currentState = eventState(current, nowMs);
  const nextState = eventState(next, nowMs);
  // While a class is running we still want to show what follows it, so both
  // cards can be on screen at once (spec §5).
  const showCurrent = current && currentState === 'IN_PROGRESS';
  const showNext = next && (nextState === 'UPCOMING' || nextState === 'STARTING_SOON');

  if (mode === 'floating') {
    return (
      <FloatingWidget
        current={showCurrent ? { event: current, state: currentState } : null}
        next={showNext ? { event: next, state: nextState } : null}
        loading={isLoading}
        hasAnySchedule={hasAnySchedule}
        nowMs={nowMs}
      />
    );
  }

  if (mode === 'compact') {
    const event = showCurrent ? current : showNext ? next : null;
    const state = showCurrent ? currentState : nextState;
    if (isLoading) return <div className={`h-16 rounded-xl bg-slate-100 animate-pulse ${className}`} />;
    if (!event) {
      return (
        <button
          type="button"
          onClick={() => navigate('/routine')}
          className={`w-full text-left bg-white border border-slate-200 rounded-xl px-4 py-3 hover:border-brand-300 ${className}`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            {hasAnySchedule ? 'All clear' : 'Routine unavailable'}
          </p>
          <p className="text-sm text-slate-500 mt-0.5">
            {hasAnySchedule ? "You're free for now." : "Your schedule hasn't been published yet."}
          </p>
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={() => navigate('/routine')}
        className={`w-full text-left bg-white border rounded-xl px-4 py-3 ${
          state === 'IN_PROGRESS' ? 'border-brand-300 bg-brand-50' : 'border-slate-200 hover:border-brand-300'
        } ${className}`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          {state === 'IN_PROGRESS' ? 'Now' : state === 'STARTING_SOON' ? 'Starting soon' : 'Next'}
        </p>
        <p className="text-sm font-semibold text-slate-800 truncate mt-0.5">
          {eventTitle(event)} <span className="font-normal text-slate-500">· {locationLine(event)}</span>
        </p>
        <p className="text-xs text-slate-500 mt-0.5">{countdownLabel(event, nowMs, state)}</p>
      </button>
    );
  }

  // ----- dashboard (default) -----
  if (isLoading) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="h-28 rounded-xl bg-slate-100 animate-pulse" />
        <div className="h-20 rounded-xl bg-slate-100 animate-pulse" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className={`bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between gap-3 ${className}`}>
        <p className="text-sm text-slate-500">Could not load today's schedule.</p>
        <button onClick={() => refetch()} className="text-sm text-brand-600 hover:underline">Retry</button>
      </div>
    );
  }

  if (!showCurrent && !showNext) {
    return (
      <div className={`bg-white border border-slate-200 rounded-xl p-5 flex items-start gap-3 ${className}`}>
        {hasAnySchedule ? (
          <CalendarDays className="text-brand-600 shrink-0 mt-0.5" size={20} />
        ) : (
          <CalendarOff className="text-slate-400 shrink-0 mt-0.5" size={20} />
        )}
        <div>
          <p className="font-semibold text-slate-700">
            {hasAnySchedule ? 'All clear' : 'Routine unavailable'}
          </p>
          <p className="text-sm text-slate-500 mt-0.5">
            {hasAnySchedule
              ? "No upcoming events — you're free for now."
              : "Your department/batch routine hasn't been published yet."}
          </p>
          <button onClick={() => navigate('/routine')} className="text-sm text-brand-600 hover:underline mt-2">
            Open calendar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {showCurrent && <EventCard event={current} state={currentState} nowMs={nowMs} prominent />}
      {showNext && (
        <EventCard
          event={next}
          state={nextState}
          nowMs={nowMs}
          heading={showCurrent ? 'Next event' : undefined}
        />
      )}
    </div>
  );
}

function EventCard({ event, state, nowMs, prominent = false, heading }) {
  const Icon = eventIcon(event);
  const pct = state === 'IN_PROGRESS' ? progressPercent(event, nowMs) : 0;
  const headingText = heading || (state === 'IN_PROGRESS' ? 'Happening now' : state === 'STARTING_SOON' ? 'Starting soon' : 'Next event');

  return (
    <div
      className={`bg-white border rounded-xl p-4 ${
        state === 'IN_PROGRESS' ? 'border-brand-300 shadow-sm' : 'border-slate-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wide ${
              state === 'IN_PROGRESS'
                ? 'bg-brand-100 text-brand-700'
                : state === 'STARTING_SOON'
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-slate-100 text-slate-500'
            }`}
          >
            {state === 'IN_PROGRESS' && <span className="w-1.5 h-1.5 rounded-full bg-brand-600 animate-pulse" />}
            {headingText}
          </span>
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{typeLabel(event)}</span>
        </div>
        <Icon className="text-slate-300 shrink-0" size={prominent ? 20 : 18} />
      </div>

      <p className={`mt-2 font-bold text-slate-800 truncate ${prominent ? 'text-lg' : 'text-base'}`}>
        {eventTitle(event)}
      </p>
      {eventSubtitle(event) && (
        <p className="text-sm text-slate-500 truncate">{eventSubtitle(event)}</p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
        <span>{timeRange(event)}</span>
        <span className="inline-flex items-center gap-1">
          <MapPin size={12} /> {locationLine(event)}
        </span>
        {event.faculty?.name && (
          <span className="inline-flex items-center gap-1">
            <UserIcon size={12} /> {event.faculty.name}
          </span>
        )}
        {event.group && event.group !== 'BOTH' && (
          <span className="inline-flex items-center gap-1">
            <Users size={12} /> {event.group}
          </span>
        )}
        {hasOnline(event) && event.onlineLink && (
          <a
            href={event.onlineLink}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-brand-600 hover:underline font-medium"
          >
            <Video size={12} /> Join class
          </a>
        )}
      </div>

      {state === 'IN_PROGRESS' && (
        <div className="mt-3">
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-brand-600 transition-[width] duration-1000 ease-linear"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-xs text-slate-500 mt-1.5">{countdownLabel(event, nowMs, state)}</p>
        </div>
      )}

      {state !== 'IN_PROGRESS' && (
        <p className="text-xs font-medium text-slate-600 mt-2">{countdownLabel(event, nowMs, state)}</p>
      )}
    </div>
  );
}

/**
 * The floating variant (spec §6). Minimised and closed states persist so the
 * widget does not reappear on every navigation after the user dismisses it.
 */
function FloatingWidget({ current, next, loading, hasAnySchedule, nowMs }) {
  const navigate = useNavigate();
  const [hidden, setHidden] = useState(() => localStorage.getItem(STORAGE_HIDDEN) === '1');
  const [minimized, setMinimized] = useState(() => localStorage.getItem(STORAGE_MINIMIZED) === '1');

  useEffect(() => {
    localStorage.setItem(STORAGE_HIDDEN, hidden ? '1' : '0');
  }, [hidden]);
  useEffect(() => {
    localStorage.setItem(STORAGE_MINIMIZED, minimized ? '1' : '0');
  }, [minimized]);

  const event = current?.event || next?.event || null;
  const state = current?.state || next?.state || null;

  // Nothing scheduled and nothing loading → stay out of the way entirely.
  if (hidden || loading || !event) return null;

  const Icon = eventIcon(event);
  const active = state === 'IN_PROGRESS';

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 bg-white border border-slate-200 shadow-lg rounded-full pl-3 pr-4 py-2 hover:border-brand-300"
      >
        <Icon className={active ? 'text-brand-600' : 'text-slate-400'} size={15} />
        <span className="text-sm font-medium text-slate-700">{eventTitle(event)}</span>
        <span className="text-xs text-slate-500">{formatGap(active ? new Date(event.endAt).getTime() - nowMs : new Date(event.startAt).getTime() - nowMs)}</span>
        <ChevronUp size={14} className="text-slate-400" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 w-72 bg-white border border-slate-200 shadow-xl rounded-xl p-3">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
            active ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-500'
          }`}
        >
          {active && <span className="w-1.5 h-1.5 rounded-full bg-brand-600 animate-pulse" />}
          {active ? 'Live now' : state === 'STARTING_SOON' ? 'Starting soon' : 'Next'}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMinimized(true)}
            className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            aria-label="Minimise schedule widget"
          >
            <ChevronDown size={14} />
          </button>
          <button
            onClick={() => setHidden(true)}
            className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
            aria-label="Close schedule widget"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <button type="button" onClick={() => navigate('/routine')} className="w-full text-left mt-2">
        <p className="font-semibold text-slate-800 truncate">{eventTitle(event)}</p>
        {eventSubtitle(event) && <p className="text-xs text-slate-500 truncate">{eventSubtitle(event)}</p>}
        <p className="text-xs text-slate-500 mt-1">
          {locationLine(event)} · {countdownLabel(event, nowMs, state)}
        </p>
      </button>

      {active && (
        <div className="mt-2 h-1 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full bg-brand-600 transition-[width] duration-1000 ease-linear"
            style={{ width: `${progressPercent(event, nowMs)}%` }}
          />
        </div>
      )}
    </div>
  );
}
