// Shared guarded status-transition state machine (work-capture primitive, BI-4C5F7A2D).
//
// Generalizes the hand-rolled transition maps that already exist in the marketing
// domain (SCHEDULED_TRANSITIONS + ALLOWED_TRANSITIONS in lib/marketing/execution.ts)
// into ONE guard, so every status-bearing work unit — scheduled actions, outbound
// drafts, and the forthcoming WorkEngagement — routes through the same transition
// logic instead of re-implementing it. Per the design review (§9.2), execution.ts
// delegates its guards here and a conformance test asserts behaviour is preserved.
//
// Pure: no DB, no external deps — unit-testable in isolation.

/** A closed allowed-transitions map: every state lists the states it may move to. */
export type TransitionMap<S extends string> = Readonly<Record<S, ReadonlyArray<S>>>;

/** True iff `to` is a declared successor of `from`. Unknown `from` → false (never throws). */
export function isAllowedTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S,
): boolean {
  return map[from]?.includes(to) ?? false;
}

/**
 * Throwing guard. Rejects an illegal move (including from === to unless the map
 * declares a self-loop) with a clear, greppable message. Mirrors the semantics
 * of the existing assertDraftTransition so it can subsume it without behaviour
 * change. `hint` appends a domain-specific remediation clause.
 */
export function assertTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S,
  opts?: { label?: string; hint?: string },
): void {
  if (!isAllowedTransition(map, from, to)) {
    const allowed = JSON.stringify(map[from] ?? []);
    throw new Error(
      `Illegal ${opts?.label ?? "status"} transition: ${JSON.stringify(from)} -> ${JSON.stringify(to)}. ` +
        `Allowed from ${JSON.stringify(from)}: ${allowed}.` +
        (opts?.hint ? ` ${opts.hint}` : ""),
    );
  }
}

export type TransitionOutcome = {
  /** false when from === to (idempotent no-op); true when a real move occurred. */
  changed: boolean;
};

/**
 * IDEMPOTENT guarded transition — the variant new work units should use. A
 * duplicate transition to the current state (e.g. two "complete" calls, or a
 * retried tick) returns { changed: false } WITHOUT error, so callers can skip
 * emitting a second activity/timeline row (external review gap #6). Any other
 * illegal move throws via assertTransition.
 */
export function evaluateTransition<S extends string>(
  map: TransitionMap<S>,
  from: S,
  to: S,
  opts?: { label?: string; hint?: string },
): TransitionOutcome {
  if (from === to) return { changed: false };
  assertTransition(map, from, to, opts);
  return { changed: true };
}
