// apps/web/lib/build/review-fix-outcome.ts
//
// BI-E492F313 — what should happen when a pre-build review fix loop ends with
// the review still failing?
//
// Both loops used to answer this with one branch: review still fails → escalate
// to a human, which ABANDONS the build, frees the WIP slot and parks the
// owner's backlog item as `deferred`. That is the right response to work the
// platform genuinely could not repair. It is the wrong response to "no engine
// could produce something to review" — nothing was learned, and the existing
// artifact and review are still valid.
//
// Live repros on the Pet Rescue install, one per phase:
//   FB-D23311A7 (design) — round 1 drew the local model, could not parse its
//     output, and the build was destroyed with a sound design doc and an
//     actionable three-issue review.
//   FB-62D7C0EC (plan)   — plan generation returned unparseable JSON on both
//     attempts of the revision, and the build was destroyed with a plan review
//     that had named five critical issues plus an architecture advisory.
//
// The design path was fixed first (#4730). This module is that same rule,
// renamed for the phase-neutral job it actually does, so the plan path cannot
// drift back to its own answer.
//
// Pure module — no Prisma, no I/O — so the policy is testable without the
// dispatch stack.

export type ReviewFixOutcomeKind =
  /** No reviewer returned a usable verdict, so nothing is known about the work. */
  | "blocked-review-incomplete"
  /** The review passed after repair. */
  | "repaired"
  /** Repair ran and the work still fails — a human decision is genuinely needed. */
  | "escalated-after-rounds"
  /** No round ever produced anything to review — infrastructure, not exhausted repair. */
  | "blocked-no-regeneration";

/**
 * Decide a fix loop's terminal outcome.
 *
 * `regenerated` is the load-bearing input: it records whether ANY round
 * actually produced a new artifact — a design document, or a build plan.
 * Without it, a loop that never regenerated is indistinguishable from one that
 * tried and failed on the merits, and the platform destroys recoverable work on
 * the strength of that confusion.
 */
export function resolveReviewFixOutcome(args: {
  reviewFailed: boolean;
  regenerated: boolean;
  /** True when the final review could not be completed (BI-D33F968A). */
  reviewIncomplete?: boolean;
}): ReviewFixOutcomeKind {
  if (!args.reviewFailed) return "repaired";
  // An unreviewable artifact is not a rejected one. Escalating here would tell
  // the owner the platform tried and could not fix their design, when in truth
  // no reviewer ever read it — live repro FB-05946F96, abandoned after two
  // rounds spent regenerating against "Both review agents failed to respond".
  if (args.reviewIncomplete) return "blocked-review-incomplete";
  return args.regenerated ? "escalated-after-rounds" : "blocked-no-regeneration";
}

/** True when the outcome must leave the build recoverable rather than abandoned. */
export function outcomeKeepsBuildRecoverable(kind: ReviewFixOutcomeKind): boolean {
  return kind === "blocked-no-regeneration" || kind === "blocked-review-incomplete";
}
