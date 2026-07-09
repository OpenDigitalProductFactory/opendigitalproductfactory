// Shared staleness math — BI-B6157FB7 (EP-8DC217EB BET-10).
//
// `now − ts > thresholdMs` and the "pick the freshest of several signal
// timestamps, then compare to now" idiom were re-implemented across the stall
// watchdog, quiescing-taskrun recovery, dead-build-phase reaper, inert-build
// reaper and scheduled-job staleness escalator. This is their one home.
//
// Neutral module (observability/, not a hot-zone) so the queue/ reaper cron,
// self-upgrade/quiescence, and build/ reaper can all import it without any of
// them owning the definition.

/**
 * True when `ts` is older than `thresholdMs` relative to `now`. A null/absent
 * timestamp is treated as stale (never heartbeated / never signalled) — the
 * conservative default every caller wants.
 */
export function isStale(
  now: Date,
  ts: Date | number | null | undefined,
  thresholdMs: number,
): boolean {
  if (ts == null) return true;
  const at = ts instanceof Date ? ts.getTime() : ts;
  if (!Number.isFinite(at)) return true;
  return now.getTime() - at > thresholdMs;
}

/**
 * The most recent (largest) of several signal timestamps, or null when none is
 * present. Used to decide liveness from whichever signal fired last — e.g. the
 * later of lastHeartbeatAt and startedAt, or of quiescedAt and lastHeartbeatAt.
 */
export function newestSignal(
  ...timestamps: Array<Date | number | null | undefined>
): Date | null {
  let best: number | null = null;
  for (const ts of timestamps) {
    if (ts == null) continue;
    const at = ts instanceof Date ? ts.getTime() : ts;
    if (!Number.isFinite(at)) continue;
    if (best === null || at > best) best = at;
  }
  return best === null ? null : new Date(best);
}

/**
 * True when the newest of the given signals is older than `thresholdMs` (or no
 * signal is present at all). Composes {@link newestSignal} + {@link isStale} —
 * the exact shape the reapers hand-rolled.
 */
export function isStaleSince(
  now: Date,
  thresholdMs: number,
  ...timestamps: Array<Date | number | null | undefined>
): boolean {
  return isStale(now, newestSignal(...timestamps), thresholdMs);
}
