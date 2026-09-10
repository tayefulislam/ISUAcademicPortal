import { useEffect, useRef, useState } from 'react';

// Shared by the authenticated QuizAttempt page and the public/guest exam
// attempt page — the timer display logic is identical either way, since
// `deadlineAt` always comes from the server (attempt.startedAt +
// quiz.duration), never computed client-side.
//
// `deadlineAt` is null until the real attempt has loaded — the timer must
// stay completely inert until then, or a null/fallback deadline reads as
// "already expired" and fires an instant auto-submit on first render.
export function useCountdown(deadlineAt, onExpire) {
  const [remaining, setRemaining] = useState(() => (deadlineAt ? Math.max(0, new Date(deadlineAt).getTime() - Date.now()) : 0));
  const expiredRef = useRef(false);

  useEffect(() => {
    if (!deadlineAt) return undefined;
    const tick = () => {
      const ms = Math.max(0, new Date(deadlineAt).getTime() - Date.now());
      setRemaining(ms);
      if (ms <= 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineAt]);

  const totalSeconds = Math.floor(remaining / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return { label: `${mm}:${ss}`, low: totalSeconds < 60 };
}

// Counts DOWN TO a future point in time (e.g. a quiz's startAt) rather than
// down to zero remaining from an already-running attempt — used on the
// pre-start listing/landing pages (Quizzes.jsx, PublicExamLanding.jsx) to
// show "Starts in ..." and flip the UI over once the window opens.
// Unlike useCountdown's mm:ss (fine for an exam's duration, at most a few
// hours), a "starts in" gap can be days away, so this formats with a day
// count once it's that far out, dropping down to hh:mm:ss/mm:ss as it gets
// closer — otherwise identical in shape (ticks every second, fires
// `onReach` exactly once when the target time arrives).
export function useCountdownTo(targetAt, onReach) {
  const [remaining, setRemaining] = useState(() => (targetAt ? Math.max(0, new Date(targetAt).getTime() - Date.now()) : 0));
  const reachedRef = useRef(false);

  useEffect(() => {
    reachedRef.current = false;
    if (!targetAt) return undefined;
    const tick = () => {
      const ms = Math.max(0, new Date(targetAt).getTime() - Date.now());
      setRemaining(ms);
      if (ms <= 0 && !reachedRef.current) {
        reachedRef.current = true;
        onReach?.();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetAt]);

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');

  const label = days > 0 ? `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;

  return { label, totalSeconds, reached: totalSeconds <= 0 };
}
