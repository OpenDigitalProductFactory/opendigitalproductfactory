// Pure capacity-drain policy — no server imports. Safe in tests and client code.
//
// "Use it or lose it": pre-paid weekly LLM allocation that isn't spent before the
// weekly reset is wasted. When we're near the reset with a HEALTHY (non-exhausted)
// pool and free build slots, proactively dispatch the top demand-ranked ready work
// to consume the remaining allocation — bounded by the WIP cap so it never
// overloads. Reuses the existing governed tee-up + WIP machinery (kernel decision
// DI-5FED0D945EBB: capacity-aware tee-up throttle, not a parallel loop).
//
// The honest signal: the provider doesn't expose remaining weekly quota, so we use
// a proxy — if the pool has NOT been rate-limited (CliPoolStatus not exhausted) and
// we're inside the drain window before the reset, there is likely unspent
// allocation worth draining. If the pool IS exhausted, the allocation is already
// fully used (or we're throttled) and we must not push more.

const MS_PER_HOUR = 3_600_000;
const HOURS_PER_WEEK = 168;

/**
 * The next weekly reset boundary strictly after `now`, for a plan that resets on
 * `resetDow` (0=Sun … 6=Sat) at `resetHourUtc` (0–23) in UTC.
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
  /** Next weekly allocation reset (see nextWeeklyReset). */
  windowResetAt: Date;
  /** Start draining once within this many hours of the reset. */
  drainWindowHours: number;
  /** CLI subscription pool currently rate-limited (allocation spent / throttled)? */
  poolExhausted: boolean;
  /** Non-terminal Build Studio builds in flight. */
  activeBuilds: number;
  /** The WIP cap on concurrent builds. */
  wipCap: number;
  /** Max builds to dispatch in a single drain evaluation. */
  maxDispatch: number;
};

export type DrainDecision = {
  drain: boolean;
  /** How many top-ranked ready items to dispatch now (0 when not draining). */
  targetDispatch: number;
  hoursUntilReset: number;
  reason: string;
};

/**
 * Decide whether — and how much — to drain now. Pure and side-effect-free; the
 * caller (a scheduled evaluator) supplies live state and acts on the result.
 */
export function evaluateDrain(input: DrainPolicyInput): DrainDecision {
  const hoursUntilReset = Math.max(0, (input.windowResetAt.getTime() - input.now.getTime()) / MS_PER_HOUR);
  const base = { drain: false as const, targetDispatch: 0, hoursUntilReset };

  if (!input.enabled) return { ...base, reason: "capacity draining disabled" };

  // A rate-limited pool means the weekly allocation is already being fully used
  // (or we're throttled). Pushing more would only pile up doomed dispatches.
  if (input.poolExhausted) {
    return { ...base, reason: "pool exhausted — allocation already spent or rate-limited" };
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

  const targetDispatch = Math.max(0, Math.min(headroom, Math.floor(input.maxDispatch)));
  if (targetDispatch === 0) {
    return { ...base, reason: "maxDispatch is 0" };
  }

  return {
    drain: true,
    targetDispatch,
    hoursUntilReset,
    reason: `draining: ${hoursUntilReset.toFixed(1)}h to reset, pool healthy, ${headroom} of ${input.wipCap} build slots free`,
  };
}
