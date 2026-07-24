"use client";

// BI-20716EA4 — shared save-state primitive for owner-facing preference/tuning
// controls. Three components (ProactivityRosterList, CoworkerPriorityDock,
// FeedbackForm) each hand-rolled an optimistic "change now, persist in the
// background" pattern that swallowed the failure with `.catch(() => {})` —
// the owner had no way to know whether a click actually saved. This hook is
// the ONE shared implementation: pending / saved / failed status, a
// plain-language retry, an automatic snap-back to the last confirmed value on
// failure (so the UI never lies about what's persisted), and a debounce with
// flush-on-unmount / flush-on-subject-switch / warn-before-tab-close so a
// pending edit is never silently lost.
//
// Pure client hook (no Prisma / server-only imports) so it can be imported by
// any "use client" component. Pair with `SaveStateIndicator`
// (components/ui/SaveStateIndicator.tsx) for the visible pending/saved/failed
// UI — this module owns the state machine, that module owns the rendering.

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "pending" | "saved" | "failed";

export type SaveOutcome = { ok: boolean; error?: string };

export interface UseSaveStateOptions<T> {
  /** The server-confirmed value (e.g. freshly loaded, or a prop from the
   *  parent). Reconciled into local state whenever nothing is pending. */
  //
  // MUST be referentially stable across renders when its content hasn't
  // changed — it drives a `useEffect([value])` resync (see below). A fresh
  // object/array literal passed inline on every render (e.g.
  // `value: { level: row.level }`) looks "changed" on every render even
  // though its content is identical, which re-fires the resync effect every
  // render and can drive an infinite render loop. Source from `useState`,
  // component props, or `useMemo` keyed on the underlying primitives — not an
  // inline literal.
  value: T;
  /** Persist a value. Return `{ ok: true }` on success or `{ ok: false, error? }`
   *  on a handled failure; a thrown/rejected promise is treated as failure too. */
  onSave: (value: T) => Promise<SaveOutcome>;
  /** Debounce delay in ms before a `change()` call is persisted. 0 (default)
   *  persists immediately. */
  debounceMs?: number;
  /** How long the "saved" status stays visible before resetting to idle so a
   *  stale "Saved" badge doesn't linger forever. Default 2000ms; 0 disables
   *  the auto-reset (status stays "saved" until the next change). */
  savedResetMs?: number;
  /** Plain-language fallback shown when `onSave` doesn't supply its own `error`. */
  failureMessage?: string;
  /** Identity of the thing being saved (e.g. an agentId). When a component
   *  instance is reused across different subjects (a docked control that
   *  stays mounted while the owner switches coworkers), pass the subject id
   *  here: on change, any debounced save still pending for the OLD subject is
   *  flushed against the OLD `onSave` before local state resets to the new
   *  `value` — so switching subjects neither drops a pending edit nor leaks
   *  one subject's failed/pending status onto another's control. */
  resetKey?: string | number;
}

export interface SaveState<T> {
  /** The value to render — optimistic while pending/saved, snapped back to
   *  the last confirmed value automatically on failure. */
  value: T;
  status: SaveStatus;
  /** Plain-language failure reason; set only when `status === "failed"`. */
  error: string | null;
  /** Apply a new value: updates the UI immediately and persists it (debounced
   *  if configured). */
  change: (next: T) => void;
  /** Re-attempt the most recent save with the same value. */
  retry: () => void;
  /** Dismiss a failed status. The optimistic value already snapped back to
   *  the last confirmed value on failure; this just clears the error banner. */
  revert: () => void;
  /** True while a debounced change is queued but hasn't fired yet. */
  hasPendingChange: () => boolean;
}

const DEFAULT_FAILURE_MESSAGE = "Couldn't save. Try again.";

export function useSaveState<T>({
  value,
  onSave,
  debounceMs = 0,
  savedResetMs = 2000,
  failureMessage = DEFAULT_FAILURE_MESSAGE,
  resetKey,
}: UseSaveStateOptions<T>): SaveState<T> {
  const [optimistic, setOptimistic] = useState<T>(value);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Last value confirmed as persisted — the auto-revert / resync target.
  const confirmedRef = useRef<T>(value);
  // The value queued to send once the debounce timer fires (or immediately).
  const lastAttemptRef = useRef<T | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  // Snapshot of `onSave` for the CURRENT subject — updated at the end of the
  // resetKey-switch effect so a flush triggered mid-switch still targets the
  // outgoing subject, not the incoming one.
  const currentOnSaveRef = useRef(onSave);
  const prevResetKeyRef = useRef<string | number | undefined>(resetKey);
  const firstResetKeyRunRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const persistWith = useCallback(
    async (save: (v: T) => Promise<SaveOutcome>, next: T) => {
      setStatus("pending");
      setError(null);
      try {
        const result = await save(next);
        if (!aliveRef.current) return;
        if (result.ok) {
          confirmedRef.current = next;
          lastAttemptRef.current = null;
          // Idempotent for the `change()` path (optimistic is already `next`);
          // load-bearing for `retry()`, which persists a value that was
          // snapped back to `confirmedRef` by the earlier failure and never
          // re-applied to `optimistic` until now.
          setOptimistic(next);
          setStatus("saved");
          if (savedResetMs > 0) {
            if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
            savedTimerRef.current = setTimeout(() => {
              if (aliveRef.current) setStatus((s) => (s === "saved" ? "idle" : s));
            }, savedResetMs);
          }
        } else {
          setOptimistic(confirmedRef.current);
          setStatus("failed");
          setError(result.error ?? failureMessage);
        }
      } catch {
        if (!aliveRef.current) return;
        setOptimistic(confirmedRef.current);
        setStatus("failed");
        setError(failureMessage);
      }
    },
    [failureMessage, savedResetMs],
  );

  // Keep the "current subject" onSave snapshot fresh on every render EXCEPT
  // during a resetKey switch (that effect below updates it itself, after
  // flushing against the OLD snapshot).
  useEffect(() => {
    if (resetKey === prevResetKeyRef.current) {
      currentOnSaveRef.current = onSave;
    }
  });

  // Subject switch (resetKey changed): flush any pending debounced save
  // against the OUTGOING subject's onSave, then reset local state to the new
  // `value` so a stale pending/failed/saved status never leaks across subjects.
  useEffect(() => {
    if (firstResetKeyRunRef.current) {
      firstResetKeyRunRef.current = false;
      prevResetKeyRef.current = resetKey;
      return;
    }
    if (resetKey === prevResetKeyRef.current) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
      const pending = lastAttemptRef.current;
      if (pending !== null) void currentOnSaveRef.current(pending).catch(() => {});
    }
    lastAttemptRef.current = null;
    currentOnSaveRef.current = onSave;
    confirmedRef.current = value;
    setOptimistic(value);
    setStatus("idle");
    setError(null);
    prevResetKeyRef.current = resetKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // External value changes (server resync) reconcile local state ONLY when
  // nothing is in flight or queued — an in-progress edit is never clobbered.
  useEffect(() => {
    if (status === "idle" && debounceTimerRef.current === null) {
      confirmedRef.current = value;
      setOptimistic(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const change = useCallback(
    (next: T) => {
      setOptimistic(next);
      lastAttemptRef.current = next;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (debounceMs > 0) {
        debounceTimerRef.current = setTimeout(() => {
          debounceTimerRef.current = null;
          void persistWith(currentOnSaveRef.current, next);
        }, debounceMs);
      } else {
        void persistWith(currentOnSaveRef.current, next);
      }
    },
    [debounceMs, persistWith],
  );

  const retry = useCallback(() => {
    const next = lastAttemptRef.current ?? optimistic;
    lastAttemptRef.current = next;
    // Re-apply the retried value optimistically (a prior failure snapped
    // `optimistic` back to `confirmedRef`) so the control shows what's being
    // retried instead of the stale reverted value while pending.
    setOptimistic(next);
    void persistWith(currentOnSaveRef.current, next);
  }, [optimistic, persistWith]);

  const revert = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    lastAttemptRef.current = null;
    setOptimistic(confirmedRef.current);
    setStatus("idle");
    setError(null);
  }, []);

  const hasPendingChange = useCallback(() => debounceTimerRef.current !== null, []);

  // True unmount (component leaves the tree entirely, not just a subject
  // switch): flush any pending debounced save and clear timers.
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        const pending = lastAttemptRef.current;
        if (pending !== null) void currentOnSaveRef.current(pending).catch(() => {});
      }
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warn before the browser tab closes/reloads while a save is still queued
  // or in flight — in-app navigation is covered by the unmount/subject-switch
  // flush above, but a hard tab close can't run an async flush reliably.
  useEffect(() => {
    if (typeof window === "undefined") return;
    function handler(e: BeforeUnloadEvent) {
      if (debounceTimerRef.current !== null || status === "pending") {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [status]);

  return { value: optimistic, status, error, change, retry, revert, hasPendingChange };
}

/**
 * Lighter one-shot variant for a single async action with no ongoing
 * optimistic value to track (e.g. a form submit) — built on the SAME
 * `useSaveState` state machine so all three call sites (roster list, priority
 * dock, feedback form) share one implementation rather than three.
 */
export function useAsyncAction<T>(
  run: (input: T) => Promise<SaveOutcome>,
  options?: { failureMessage?: string },
) {
  const save = useSaveState<T | null>({
    value: null,
    onSave: (input) => run(input as T),
    debounceMs: 0,
    savedResetMs: 0,
    ...(options?.failureMessage !== undefined ? { failureMessage: options.failureMessage } : {}),
  });

  return {
    status: save.status,
    error: save.error,
    run: (input: T) => save.change(input),
    retry: save.retry,
    dismiss: save.revert,
  };
}
