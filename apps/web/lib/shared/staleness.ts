// lib/shared/staleness.ts — EP-8DC217EB BET-10
//
// One home for the two liveness-math idioms that were reimplemented 6+ times
// across the watchdog / reaper / staleness-escalation surfaces:
//
//   1. "has this timestamp gone stale?"  now - ts > thresholdMs
//   2. "which of these signals is newest?" (max non-null timestamp)
//
// The "newest-signal then compare" pair (newestSignal → isStale) was copied
// verbatim in isStuckQuiescingTaskRun, isBuildPhaseReapable, and
// isTaskRunReapable. Both helpers take `now` explicitly so callers stay pure
// and testable (never call Date.now() inside — inject it).
//
// The CI ratchet scripts/check-no-local-liveness-literal.mjs discourages new
// local `now - x > threshold` reimplementations outside this module.

/**
 * True when `ts` is older than `thresholdMs` relative to `now`. Strict `>`
 * (a signal exactly at the threshold is NOT yet stale), matching the watchdog
 * and reaper conventions. A null/undefined `ts` is treated as "no signal" and
 * returns false — callers that want to guess must do so explicitly.
 */
export function isStale(
  now: Date,
  ts: Date | null | undefined,
  thresholdMs: number,
): boolean {
  if (!ts) return false;
  return now.getTime() - ts.getTime() > thresholdMs;
}

/**
 * Return the newest (largest) of the given timestamps, ignoring null/undefined.
 * Returns null when every argument is null/undefined (no observable signal).
 */
export function newestSignal(
  ...timestamps: (Date | null | undefined)[]
): Date | null {
  let newest: Date | null = null;
  for (const ts of timestamps) {
    if (!ts) continue;
    if (newest === null || ts.getTime() > newest.getTime()) newest = ts;
  }
  return newest;
}
