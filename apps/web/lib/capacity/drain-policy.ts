// Pure capacity-drain policy — no server imports. Safe in tests and client code.
//
// "Use it or lose it": pre-paid weekly LLM allocation that isn't spent before the
// weekly reset is wasted. When we're near the reset with remaining allocation and
// free build slots, proactively dispatch the top demand-ranked ready work to
// consume it — bounded by the WIP cap so it never overloads. Reuses the existing
// governed tee-up + WIP machinery (kernel decision DI-5FED0D945EBB: capacity-aware
// tee-up throttle, not a parallel loop).
//
// THE SIGNAL — real, with a proxy fallback:
//   • REAL (preferred): the provider exposes remaining weekly quota after all —
//     the same number every subscription client renders. When a FRESH snapshot is
//     available (see weekly-quota.ts), we drain on `weeklyRemainingRatio` (1 −
//     utilization) and the provider-authoritative `weeklyResetAt`, and stop once
//     the allocation is essentially spent. This replaces the old proxy.
//   • PROXY (fallback): when no fresh snapshot exists (collector not yet wired, a
//     stale/failed read, or an API-key install off the subscription meter), we
//     fall back to the original heuristic — pool NOT rate-limited + inside a
//     window before a locally-computed reset.
//
// A 429 in flight (`poolExhausted`) is a hard stop in BOTH modes.
//
// RESET MODEL: research disproved the fixed-weekly-day assumption — the true reset
// is a rolling ~72h anchored window, and the provider's own `resetsAt` is
// authoritative. So `weeklyResetAt` (when present) wins; `nextWeeklyReset` below is
// only the fallback used when we have no provider reset at all.

const MS_PER_HOUR = 3_600_000;
const HOURS_PER_WEEK = 168;

/**
 * Below this remaining fraction, the weekly allocation is essentially spent —
 * draining more would only pile work into a near-empty budget. This is the real
 * signal's replacement for the proxy's `poolExhausted` stop.
 */
const DEFAULT_MIN_REMAINING_TO_DRAIN = 0.05;

/**
 * FALLBACK ONLY. The next weekly reset boundary strictly after `now`, for a plan
 * that resets on `resetDow` (0=Sun … 6=Sat) at `resetHourUtc` (0–23) in UTC.
 *
 * Retained only for the proxy path — when the provider gives us no `resetsAt`. The
 * real reset is a rolling ~72h anchored window (not a fixed calendar day), so
 * prefer the provider-authoritative `weeklyResetAt` whenever it is available.
 */
export function nextWeeklyReset(now: Date, resetDow: number, resetHourUtc: number): Date {
  const dow = ((resetDow % 7) + 7) % 7;
  const hour = Math.min(23, Math.max(0, Math.floor(resetHourUtc)));
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, 0, 0, 0),
  );
  // Advance to the target day-of-week.
  const dayDelta = (dow - candidate.getUTCDay() + 7) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + dayDelta);
  // If that lands at or before now, jump a full week.
  if (candidate.getTime() <= now.getTime()) {
    candidate.setUTCDate(candidate.getUTCDate() + 7);
  }
  return candidate;
}

export type DrainPolicyInput = {
  enabled: boolean;
  now: Date;
  /**
   * Weekly allocation reset. Prefer the provider-authoritative value; fall back
   * to nextWeeklyReset() only when no provider reset is available.
   */
  windowResetAt: Date;
  /** Start draining once within this many hours of the reset. */
  drainWindowHours: number;
  /** CLI subscription pool currently rate-limited (429 in flight)? Hard stop. */
  poolExhausted: boolean;
  /** Non-terminal Build Studio builds in flight. */
  activeBuilds: number;
  /** The WIP cap on concurrent builds. */
  wipCap: number;
  /** Max builds to dispatch in a single drain evaluation. */
  maxDispatch: number;
  /**
   * REAL SIGNAL: remaining weekly allocation as a fraction 0..1 (1 = fully
   * unused), from a FRESH provider quota snapshot. Undefined when no fresh
   * snapshot exists — the policy then falls back to the poolExhausted proxy.
   */
  weeklyRemainingRatio?: number;
  /**
   * Below this remaining fraction the allocation is essentially spent; stop
   * draining. Only consulted when weeklyRemainingRatio is provided. Defaults to
   * DEFAULT_MIN_REMAINING_TO_DRAIN.
   */
  minRemainingToDrain?: number;
};

export type DrainDecision = {
  drain: boolean;
  /** How many top-ranked ready items to dispatch now (0 when not draining). */
  targetDispatch: number;
  hoursUntilReset: number;
  /** "real" when driven by a fresh quota snapshot, "proxy" when using the fallback. */
  signal: "real" | "proxy";
  reason: string;
};

/**
 * Decide whether — and how much — to drain now. Pure and side-effect-free; the
 * caller (a scheduled evaluator) supplies live state and acts on the result.
 *
 * Uses the REAL remaining-allocation signal when a fresh snapshot is present
 * (weeklyRemainingRatio defined); otherwise falls back to the pool-exhaustion
 * proxy. A 429 in flight (poolExhausted) is a hard stop in both modes.
 */
export function evaluateDrain(input: DrainPolicyInput): DrainDecision {
  const hoursUntilReset = Math.max(0, (input.windowResetAt.getTime() - input.now.getTime()) / MS_PER_HOUR);
  const hasRealSignal = typeof input.weeklyRemainingRatio === "number";
  const signal: "real" | "proxy" = hasRealSignal ? "real" : "proxy";
  const base = { drain: false as const, targetDispatch: 0, hoursUntilReset, signal };

  if (!input.enabled) return { ...base, reason: "capacity draining disabled" };

  // A 429 in flight means back off regardless of what the quota number says —
  // pushing more would only pile up doomed dispatches.
  if (input.poolExhausted) {
    return { ...base, reason: "pool exhausted — 429 in flight, backing off" };
  }

  // Real-signal gate: if the weekly allocation is essentially spent, stop. This
  // is the honest replacement for the proxy's "pool exhausted" stop — a low
  // remaining number is the direct read the proxy could only infer from a 429.
  const remaining = input.weeklyRemainingRatio ?? 1;
  const minRemaining = input.minRemainingToDrain ?? DEFAULT_MIN_REMAINING_TO_DRAIN;
  if (hasRealSignal && remaining <= minRemaining) {
    return {
      ...base,
      reason: `weekly allocation spent (${(remaining * 100).toFixed(0)}% remaining ≤ ${(minRemaining * 100).toFixed(0)}% floor)`,
    };
  }

  // Only drain the tail of the window; the normal cadence covers the rest.
  const window = Math.min(HOURS_PER_WEEK, Math.max(0, input.drainWindowHours));
  if (hoursUntilReset > window) {
    return { ...base, reason: `not in drain window (${hoursUntilReset.toFixed(1)}h > ${window}h until reset)` };
  }

  const headroom = input.wipCap - input.activeBuilds;
  if (headroom <= 0) {
    return { ...base, reason: `WIP cap reached (${input.activeBuilds}/${input.wipCap}) — no free slots` };
  }

  const capBound = Math.max(0, Math.floor(input.maxDispatch));
  // With the real signal, scale dispatch to how much is left — burn harder when
  // there's plenty of unused allocation, gently when it's nearly gone. In proxy
  // mode there is no remaining number, so dispatch up to the full cap.
  const scaled = hasRealSignal ? Math.ceil(capBound * remaining) : capBound;
  const targetDispatch = Math.max(0, Math.min(headroom, capBound, scaled));
  if (targetDispatch === 0) {
    return { ...base, reason: input.maxDispatch <= 0 ? "maxDispatch is 0" : "nothing to dispatch" };
  }

  const detail = hasRealSignal
    ? `${(remaining * 100).toFixed(0)}% weekly allocation remaining`
    : "pool healthy (proxy)";
  return {
    drain: true,
    targetDispatch,
    hoursUntilReset,
    signal,
    reason: `draining (${signal}): ${hoursUntilReset.toFixed(1)}h to reset, ${detail}, ${headroom} of ${input.wipCap} build slots free`,
  };
}
