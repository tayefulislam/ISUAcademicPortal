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
