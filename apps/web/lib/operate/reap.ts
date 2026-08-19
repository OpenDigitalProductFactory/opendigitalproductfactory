// apps/web/lib/operate/reap.ts — EP-8DC217EB BET-10
//
// One skeleton for the 4-5 reapers that share the same shape:
//
//   coarse indexed scan (cutoff = now - thresholdMs, take N)
//     → per-candidate PURE isReapable(candidate)
//     → per-row transition (its own $transaction re-check + state change +
//       audit row + optional notification), error-isolated
//     → count reaped.
//
// The framework owns ONLY the neutral skeleton (iterate, gate, isolate errors,
// count). Every DB-specific decision stays in the caller's callbacks, so the
// reaper's observable behavior is unchanged — this is a control-flow
// consolidation, not a policy change.
//
// NEUTRAL-HOME RULE (plan §4): this lives in lib/operate/ (the ONE operations
// namespace after the Simplify & Strengthen W10 merge), deliberately
// OUTSIDE the collision hot-zones (lib/queue, lib/tak, lib/routing, lib/govern).
// The Inngest cron wiring stays in lib/queue/functions/* as a thin shell that
// imports this framework; the reaper primitives themselves are neutral.

export interface ReapResult {
  /** Candidates returned by the coarse scan. */
  scanned: number;
  /** Rows the transition actually reaped (transition returned a positive count). */
  reaped: number;
}

export interface ReapSpec<C> {
  /** Coarse indexed scan — returns the candidate rows (already capped/take'd). */
  scan: () => Promise<C[]>;
  /** Pure per-candidate gate. No IO — decides eligibility from the row + now. */
  isReapable: (candidate: C) => boolean;
  /**
   * Per-row transition: does its own $transaction re-check + state change +
   * audit/notify writes. Returns how many rows it settled (0 if it lost the
   * re-check race). A throw is caught and routed to onError; the sweep
   * continues (best-effort per row, matching every existing reaper).
   */
  transition: (candidate: C) => Promise<number>;
  /** Optional per-row error sink (defaults to a console.warn). */
  onError?: (candidate: C, err: unknown) => void;
}

/**
 * Run a reaper over its candidates. Behavior-preserving skeleton: scan once,
 * gate each candidate through the pure predicate, transition the survivors with
 * per-row error isolation, and tally the settled rows.
 */
export async function reap<C>(spec: ReapSpec<C>): Promise<ReapResult> {
  const candidates = await spec.scan();
  let reaped = 0;
  for (const candidate of candidates) {
    if (!spec.isReapable(candidate)) continue;
    try {
      reaped += await spec.transition(candidate);
    } catch (err) {
      if (spec.onError) spec.onError(candidate, err);
      else console.warn("[reap] transition failed for a candidate:", err);
    }
  }
  return { scanned: candidates.length, reaped };
}
