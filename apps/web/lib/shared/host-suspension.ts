// lib/shared/host-suspension.ts — BI-4FDE4050
//
// Time this process spent suspended (host asleep, VM paused) must not count as
// silence from a heartbeating executor.
//
// Docker Desktop pauses its VM while the Mac sleeps: the guest's monotonic
// clock stops and its wall clock is stepped forward on wake. A heartbeat
// ticker (setInterval runs on the monotonic clock) therefore waits out the rest
// of its interval after wake, while a wall-clock cron fires at once and reads a
// heartbeat that is minutes "old" although the process ran only for seconds.
//
// Suspension is observable from inside the process: wall-clock advance minus
// monotonic advance. Each observation records the drift when it moves, so a
// liveness check can give back the suspension that happened after a signal.
// The ledger is process-local and lives on globalThis so every bundled copy of
// this module shares one record. A fresh process has no record before it
// started, so it credits nothing for that time (a restart is still loss).

export interface HostClock {
  wallMs(): number;
  monotonicMs(): number;
}

/** Drift movements below this are clock noise (NTP slew, rounding), not suspension. */
const DRIFT_STEP_MS = 1_000;
const RETAIN_MS = 24 * 60 * 60 * 1_000;
const MAX_ENTRIES = 256;

const systemClock: HostClock = { wallMs: () => Date.now(), monotonicMs: () => performance.now() };

export function createHostSuspensionLedger(clock: HostClock = systemClock) {
  const origin = clock.wallMs() - clock.monotonicMs();
  // Each entry: from wallMs onward, observed drift was driftMs.
  let entries: { wallMs: number; driftMs: number }[] = [{ wallMs: clock.wallMs(), driftMs: 0 }];

  function observe(): number {
    const wallMs = clock.wallMs();
    const driftMs = wallMs - clock.monotonicMs() - origin;
    if (Math.abs(driftMs - entries[entries.length - 1]!.driftMs) >= DRIFT_STEP_MS) {
      entries.push({ wallMs, driftMs });
      const cutoff = wallMs - RETAIN_MS;
      let keepFrom = 0;
      for (let i = 0; i < entries.length - 1; i += 1) if (entries[i + 1]!.wallMs <= cutoff) keepFrom = i + 1;
      entries = entries.slice(Math.max(keepFrom, entries.length - MAX_ENTRIES));
    }
    return driftMs;
  }

  /**
   * Milliseconds this process was suspended after `since`. A suspension is
   * only seen at the next observation, so one that straddles `since` counts
   * in full: the error is toward patience, never toward declaring loss.
   */
  function suspendedMsSince(since: Date): number {
    const driftNow = observe();
    const at = since.getTime();
    let base = entries[0]!;
    for (const entry of entries) if (entry.wallMs <= at) base = entry;
    return Math.max(0, driftNow - base.driftMs);
  }

  return { observe, suspendedMsSince };
}

type Ledger = ReturnType<typeof createHostSuspensionLedger>;
const KEY = Symbol.for("dpf.hostSuspensionLedger");
function ledger(): Ledger {
  const holder = globalThis as unknown as Record<symbol, Ledger | undefined>;
  return (holder[KEY] ??= createHostSuspensionLedger());
}

/** Record the clock relationship now. Cheap; call on every heartbeat write. */
export function observeHostClock(): void {
  ledger().observe();
}

/** Milliseconds this process spent suspended after `since`. */
export function hostSuspendedMsSince(since: Date): number {
  return ledger().suspendedMsSince(since);
}

/**
 * `now` with the suspension after `since` removed — the instant to measure a
 * liveness signal's age against, e.g. `isStale(livenessNow(now, hb), hb, ms)`.
 */
export function livenessNow(now: Date, since: Date): Date {
  return new Date(now.getTime() - hostSuspendedMsSince(since));
}
