// Advisory guard for the "status flip mistaken for starting work" failure.
// BI-59344EA2 (coworker over-claim guard). Relates to EP-COWORKER-RT / EP-BIZ-CAP.
//
// A coworker (the COO) was told to "execute" the top recommended backlog item
// and called update_backlog_item_status(in-progress) on a triageOutcome=build
// item — then reported it as "added active throughput". But flipping a build
// item to in-progress does NOT create a FeatureBuild, nothing enters Build
// Studio, and (worse) it leaves the item ineligible for promote_to_build_studio,
// which requires status=open. The status change is bookkeeping, not work.
//
// This is a non-blocking advisory: the transition still succeeds, but the tool
// result carries a message the model is expected to surface/act on, so prompt
// drift can't silently re-introduce the over-claim. It encodes the
// structural-verification-is-not-functional commandment at the tool boundary.

export type PromoteAdvisoryInput = {
  itemId: string;
  /** The status the item is being moved to. */
  targetStatus: string;
  /** The item's triage outcome (only "build" items go through Build Studio). */
  triageOutcome: string | null;
  /** Whether the item already has an active FeatureBuild linked. */
  hasActiveBuild: boolean;
};

/**
 * Return an advisory string when a triaged build item is being marked
 * in-progress without an active Build Studio build — i.e. when a status flip
 * is about to be mistaken for starting the work. Returns null otherwise (the
 * common case), so callers attach it only when it matters.
 */
export function buildPromoteAdvisory(
  input: PromoteAdvisoryInput,
): string | null {
  const movingToInProgress = input.targetStatus === "in-progress";
  const isBuildItem = input.triageOutcome === "build";
  if (!movingToInProgress || !isBuildItem || input.hasActiveBuild) {
    return null;
  }

  return (
    `${input.itemId} is a build item (triageOutcome=build) with no active Build Studio build. ` +
    `Marking it in-progress only changes the status field — it does NOT create a build or start any work, ` +
    `and it does not engage Build Studio. To actually start a build item, use promote_to_build_studio ` +
    `(which creates the FeatureBuild and begins Ideate); note that promotion requires status=open, so this ` +
    `item must be returned to open first. Do NOT report this status change as work started, in progress, or building.`
  );
}
