// apps/web/lib/build/design-fix-outcome.ts
//
// BI-E492F313 — what should happen when the design-review fix loop ends with the
// review still failing?
//
// The loop used to answer this with one branch: review still fails → escalate to
// a human, which ABANDONS the build, frees the WIP slot and parks the owner's
// backlog item as `deferred`. That is the right response to a design the
// platform genuinely could not repair. It is the wrong response to "no engine
// could produce a design to review" — nothing was learned about the design, and
// the existing doc and review are still valid.
//
// Live repro FB-D23311A7 on the Pet Rescue install: round 1 drew the local
// model, could not parse its output, and the build was destroyed — taking a
// sound design doc and an actionable three-issue review with it.
//
// Pure module — no Prisma, no I/O — so the policy is testable without the
// dispatch stack.

export type DesignFixOutcomeKind =
  /** The review passed after repair. */
  | "repaired"
  /** Repair ran and the design still fails — a human decision is genuinely needed. */
  | "escalated-after-rounds"
  /** No round ever produced a design to review — infrastructure, not exhausted repair. */
  | "blocked-no-regeneration";

/**
 * Decide the loop's terminal outcome.
 *
 * `regenerated` is the load-bearing input: it records whether ANY round actually
 * produced a new design document. Without it, a loop that never regenerated is
 * indistinguishable from one that tried and failed on the merits — and the
 * platform destroys recoverable work on the strength of that confusion.
 */
export function resolveDesignFixOutcome(args: {
  reviewFailed: boolean;
  regenerated: boolean;
}): DesignFixOutcomeKind {
  if (!args.reviewFailed) return "repaired";
  return args.regenerated ? "escalated-after-rounds" : "blocked-no-regeneration";
}

/** True when the outcome must leave the build recoverable rather than abandoned. */
export function outcomeKeepsBuildRecoverable(kind: DesignFixOutcomeKind): boolean {
  return kind === "blocked-no-regeneration";
}
