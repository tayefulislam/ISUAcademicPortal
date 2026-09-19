import { useCallback, useRef, useState } from 'react';

const MAX_ENTRIES = 60;
// Two edits to the same field inside this window are treated as one step, so
// typing in the property panel (or holding an arrow key) does not fill the
// history with an entry per keystroke.
const COALESCE_MS = 800;

/**
 * Undo/redo for a single piece of state — the template design being edited.
 *
 * <p>Two shapes of change, because they need different history:
 * <ul>
 *   <li>a <b>gesture</b> — dragging or resizing on the canvas. `begin()` opens
 *       it, `update()` fires on every pointer move but records only the first
 *       (so one drag is one undo step), `end()` closes it;</li>
 *   <li>a <b>discrete edit</b> — `commit()`, optionally coalesced by key.</li>
 * </ul>
 *
 * <p>The current value is mirrored in a ref so snapshots are taken OUTSIDE the
 * state updater: a reducer must stay pure (React may invoke it twice), and a
 * ref mutated inside one would record the same step twice.
 */
export default function useHistory(initialValue) {
  const [state, setState] = useState(initialValue);
  const stateRef = useRef(initialValue);
  const past = useRef([]);
  const future = useRef([]);
  const gesture = useRef(null);
  const lastCommit = useRef({ key: null, at: 0 });

  const apply = useCallback((value) => {
    stateRef.current = value;
    setState(value);
  }, []);

  const push = useCallback((snapshot) => {
    past.current.push(snapshot);
    if (past.current.length > MAX_ENTRIES) past.current.shift();
    future.current = [];
  }, []);

  const resolve = (next, current) => (typeof next === 'function' ? next(current) : next);

  /** Replaces the value and clears the history (used when another version loads). */
  const reset = useCallback((value) => {
    past.current = [];
    future.current = [];
    gesture.current = null;
    lastCommit.current = { key: null, at: 0 };
    apply(value);
  }, [apply]);

  /** Opens a continuous gesture (a drag or a resize). */
  const begin = useCallback(() => {
    gesture.current = { recorded: false };
  }, []);

  /** A pointer move inside a gesture: records the pre-gesture state once. */
  const update = useCallback((next) => {
    const current = stateRef.current;
    if (gesture.current) {
      if (!gesture.current.recorded) {
        push(current);
        gesture.current.recorded = true;
      }
    } else {
      // An update outside a declared gesture is still one step.
      push(current);
    }
    apply(resolve(next, current));
  }, [apply, push]);

  const end = useCallback(() => {
    gesture.current = null;
  }, []);

  /**
   * A discrete change. `coalesceKey` groups rapid edits that belong to one
   * intent (all keystrokes into one property, say) into a single undo step.
   */
  const commit = useCallback((next, coalesceKey = null) => {
    const current = stateRef.current;
    const now = Date.now();
    const previous = lastCommit.current;
    const merge = Boolean(coalesceKey)
      && previous.key === coalesceKey
      && now - previous.at < COALESCE_MS;
    // When merging, the entry already recorded at the START of this run is kept;
    // only the present changes, so undo goes back past the whole run.
    if (!merge) push(current);
    lastCommit.current = { key: coalesceKey, at: now };
    apply(resolve(next, current));
  }, [apply, push]);

  const undo = useCallback(() => {
    if (!past.current.length) return;
    const previous = past.current.pop();
    future.current.unshift(stateRef.current);
    lastCommit.current = { key: null, at: 0 };
    gesture.current = null;
    apply(previous);
  }, [apply]);

  const redo = useCallback(() => {
    if (!future.current.length) return;
    const next = future.current.shift();
    past.current.push(stateRef.current);
    lastCommit.current = { key: null, at: 0 };
    gesture.current = null;
    apply(next);
  }, [apply]);

  // Both are read during the render that the value change triggers, so they are
  // always current.
  return {
    state,
    reset,
    begin,
    update,
    end,
    commit,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}
