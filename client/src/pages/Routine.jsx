import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search, Video, MapPin, User as UserIcon } from 'lucide-react';
import { routineApi } from '../api/endpoints.js';
import { useAuth } from '../context/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import RoutinePdfDialog from '../components/routine/RoutinePdfDialog.jsx';
import SmartEventWidget from '../components/routine/SmartEventWidget.jsx';
import {
  eventIcon, eventTitle, eventSubtitle, typeLabel, timeRange, locationLine, hasOnline, clock,
  eventState, dayLabel, dhakaDate,
} from '../components/routine/eventMeta.js';
import { dhakaInputToIso } from '../utils/format.js';
import { trackClarityEvent } from '../analytics/clarity.js';

// The academic calendar: Day / Week / Month / Agenda (spec §12, §13).
//
// Every view reads the same endpoint with a different window, and the window is
// expressed in Dhaka wall-clock and converted by dhakaInputToIso — institutional
// times must not shift with the viewer's own timezone or a wrong device clock.

const VIEWS = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'agenda', label: 'Agenda' },
];

const TYPE_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'CLASS', label: 'Classes' },
  { key: 'EXAM', label: 'Exams' },
  { key: 'EVENT', label: 'Events' },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** The id behind a reference the server may send populated or bare. */
const refId = (value) => (value && typeof value === 'object' ? value._id : value) || '';

/** ISO instant for a Dhaka date + time. */
const atDhaka = (dateStr, time = '00:00') => dhakaInputToIso(`${dateStr}T${time}`);

function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * MS_PER_DAY);
  return shifted.toISOString().slice(0, 10);
}

/** 0 = Sunday, computed from the date's own digits (never from a parsed instant). */
function weekdayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function startOfWeek(dateStr) {
  return shiftDate(dateStr, -weekdayOf(dateStr));
}

function monthBounds(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { first, next };
}

/** The [from, to) window each view asks the server for. */
function windowFor(view, anchor) {
  if (view === 'day') return { from: atDhaka(anchor), to: atDhaka(shiftDate(anchor, 1)) };
  if (view === 'week') {
    const start = startOfWeek(anchor);
    return { from: atDhaka(start), to: atDhaka(shiftDate(start, 7)) };
  }
  if (view === 'month') {
    const { first, next } = monthBounds(anchor);
    return { from: atDhaka(first), to: atDhaka(next) };
  }
  // Agenda reaches forward so "tomorrow" and next week are included.
  return { from: atDhaka(anchor), to: atDhaka(shiftDate(anchor, 30)) };
}

export default function Routine() {
  const today = dhakaDate();
  const { user } = useAuth();
  const [view, setView] = useState('day');
  const [anchor, setAnchor] = useState(today);
  const [typeFilter, setTypeFilter] = useState('all');
  const [term, setTerm] = useState('');

  useEffect(() => {
    trackClarityEvent('routine_viewed');
  }, []);

  const { from, to } = useMemo(() => windowFor(view, anchor), [view, anchor]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['routine', 'window', from, to],
    queryFn: () => routineApi.mine({ from, to }),
  });

  const { data: widgetData } = useQuery({
    queryKey: ['routine', 'current-next'],
    queryFn: routineApi.currentNext,
    staleTime: 60_000,
  });
  const hasAnySchedule = widgetData?.data?.hasAnySchedule;

  const events = data?.data || [];

  // Filters are client-side over the already-scoped window: the server has
  // decided what this user may see, so filtering can only ever narrow.
  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    return events.filter((e) => {
      if (typeFilter !== 'all' && e.eventType !== typeFilter) return false;
      if (!q) return true;
      const haystack = [e.course?.code, e.course?.name, e.faculty?.name, e.room, e.title, e.group]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [events, typeFilter, term]);

  const byDay = useMemo(() => {
    const map = new Map();
    for (const e of filtered) {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date).push(e);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const step = view === 'day' ? 1 : view === 'week' ? 7 : 0;
  const shiftAnchor = (direction) => {
    if (view === 'month') {
      const [y, m] = anchor.split('-').map(Number);
      const nextMonth = m + direction;
      const normalised = new Date(Date.UTC(y, nextMonth - 1, 1));
      setAnchor(normalised.toISOString().slice(0, 10));
      return;
    }
    setAnchor(shiftDate(anchor, step * direction));
  };

  const heading = view === 'month'
    ? new Date(`${monthBounds(anchor).first}T00:00:00+06:00`).toLocaleDateString('en-US', {
        timeZone: 'Asia/Dhaka', month: 'long', year: 'numeric',
      })
    : view === 'agenda'
      ? 'Next 30 days'
      : view === 'week'
        ? `${startOfWeek(anchor)} → ${shiftDate(startOfWeek(anchor), 6)}`
        : new Date(`${anchor}T00:00:00+06:00`).toLocaleDateString('en-US', {
            timeZone: 'Asia/Dhaka', weekday: 'long', day: 'numeric', month: 'long',
          });

  const nowMs = Date.now();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Calendar</h1>
          <p className="text-sm text-slate-500 mt-0.5">Your classes, exams and academic events.</p>
          {/* Anyone can print a timetable: the scope picker defaults to the
              signed-in user's own department/batch/semester. */}
          <div className="mt-3">
            <RoutinePdfDialog
              defaultDepartment={refId(user?.department)}
              defaultBatch={refId(user?.batch)}
              defaultSemester={refId(user?.semester)}
            />
          </div>
        </div>
        <div className="w-full sm:w-80">
          <SmartEventWidget mode="compact" />
        </div>
      </div>

      {/* View tabs */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => { setView(v.key); setAnchor(today); }}
              className={`px-3.5 py-2 text-sm font-medium transition-colors ${
                view === v.key ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'
              }`}
              aria-pressed={view === v.key}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-auto">
          {/* Custom date: jump the calendar straight to any day. Bound directly
              to `anchor` so Prev/Today/Next and the view tabs keep it in step.
              A bare date is validated as a real YYYY-MM-DD and interpreted in
              the institution's clock, exactly like the other views. */}
          <label className="flex items-center gap-1.5 text-xs text-slate-500 mr-1">
            <span className="hidden sm:inline">Custom</span>
            <input
              type="date"
              value={anchor}
              onChange={(e) => {
                const value = e.target.value;
                if (
                  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
                  !Number.isNaN(new Date(`${value}T00:00:00+06:00`).getTime())
                ) {
                  setAnchor(value);
                }
              }}
              aria-label="Custom date"
              className="px-2.5 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-600"
            />
          </label>
          <button onClick={() => shiftAnchor(-1)} className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50" aria-label="Previous">
            <ChevronLeft size={16} />
          </button>
          <button onClick={() => setAnchor(today)} className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-600 hover:bg-slate-50">
            Today
          </button>
          <button onClick={() => shiftAnchor(1)} className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50" aria-label="Next">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <p className="text-sm font-semibold text-slate-700 mb-3">{heading}</p>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <div className="flex flex-wrap gap-1.5">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                typeFilter === f.key
                  ? 'bg-brand-600 border-brand-600 text-white'
                  : 'bg-white border-slate-200 text-slate-600 hover:border-brand-300'
              }`}
              aria-pressed={typeFilter === f.key}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Course, faculty or room"
            className="w-full pl-8 pr-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}
        </div>
      ) : isError ? (
        <EmptyState title="Calendar unavailable" description="The routine system may be switched off. Try again later." />
      ) : view === 'month' ? (
        <MonthGrid anchor={anchor} events={filtered} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={view === 'day' ? 'No classes' : 'Nothing scheduled'}
          description={
            hasAnySchedule === false
              ? "Your department/batch routine hasn't been published yet."
              : view === 'day'
                ? "You have a free day."
                : 'Nothing matches this view or filter.'
          }
        />
      ) : (
        <div className="space-y-5">
          {byDay.map(([date, dayEvents]) => (
            <section key={date}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                {dayLabel(date, today, shiftDate(today, 1))}
              </h2>
              <div className="space-y-2">
                {dayEvents.map((e) => (
                  <EventRow key={e.id} event={e} nowMs={nowMs} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ event, nowMs }) {
  const Icon = eventIcon(event);
  const state = eventState(event, nowMs);
  const cancelled = state === 'CANCELLED' || event.status === 'CANCELLED';

  return (
    <div
      className={`bg-white border rounded-xl p-4 flex items-start gap-3 ${
        cancelled ? 'border-slate-200 opacity-60' : state === 'IN_PROGRESS' ? 'border-brand-300' : 'border-slate-200'
      }`}
    >
      <span className="shrink-0 w-9 h-9 rounded-lg bg-slate-50 grid place-items-center">
        <Icon size={16} className={state === 'IN_PROGRESS' ? 'text-brand-600' : 'text-slate-400'} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-slate-800 truncate">{eventTitle(event)}</p>
          <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {typeLabel(event)}
          </span>
          {state === 'IN_PROGRESS' && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-100 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-600 animate-pulse" /> Live
            </span>
          )}
          {cancelled && (
            <span className="px-2 py-0.5 rounded-full bg-red-50 text-[10px] font-semibold uppercase tracking-wide text-red-600">
              Cancelled
            </span>
          )}
          {event.status === 'RESCHEDULED' && (
            <span className="px-2 py-0.5 rounded-full bg-amber-50 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              Moved
            </span>
          )}
        </div>

        {eventSubtitle(event) && <p className="text-sm text-slate-500 truncate">{eventSubtitle(event)}</p>}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-500">
          <span>{timeRange(event)}</span>
          <span className="inline-flex items-center gap-1"><MapPin size={12} /> {locationLine(event)}</span>
          {event.faculty?.name && <span className="inline-flex items-center gap-1"><UserIcon size={12} /> {event.faculty.name}</span>}
          {event.group && event.group !== 'BOTH' && <span>Group {event.group}</span>}
          {hasOnline(event) && event.onlineLink && (
            <a href={event.onlineLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline font-medium">
              <Video size={12} /> Join
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ anchor, events }) {
  const { first } = monthBounds(anchor);
  const leading = weekdayOf(first);
  const daysInMonth = (() => {
    const [y, m] = first.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  })();

  const byDate = useMemo(() => {
    const map = new Map();
    for (const e of events) {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date).push(e);
    }
    return map;
  }, [events]);

  const cells = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${first.slice(0, 8)}${String(i + 1).padStart(2, '0')}`),
  ];

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center mb-1">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <span key={d} className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 py-1">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((date, i) => (
          <div
            key={date || `pad-${i}`}
            className={`min-h-[72px] rounded-lg border p-1.5 ${
              date ? 'bg-white border-slate-200' : 'bg-transparent border-transparent'
            } ${date === dhakaDate() ? 'ring-1 ring-brand-300' : ''}`}
          >
            {date && (
              <>
                <p className="text-[11px] font-semibold text-slate-500">{Number(date.slice(8, 10))}</p>
                <div className="space-y-0.5 mt-0.5">
                  {(byDate.get(date) || []).slice(0, 3).map((e) => (
                    <p
                      key={e.id}
                      className={`text-[10px] truncate rounded px-1 py-0.5 ${
                        e.eventType === 'EXAM'
                          ? 'bg-amber-50 text-amber-700'
                          : e.eventType === 'DEADLINE'
                            ? 'bg-red-50 text-red-600'
                            : 'bg-brand-50 text-brand-700'
                      }`}
                      title={`${eventTitle(e)} · ${timeRange(e)}`}
                    >
                      {clock(e.startTime)} {eventTitle(e)}
                    </p>
                  ))}
                  {(byDate.get(date) || []).length > 3 && (
                    <p className="text-[10px] text-slate-400">+{(byDate.get(date) || []).length - 3} more</p>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
