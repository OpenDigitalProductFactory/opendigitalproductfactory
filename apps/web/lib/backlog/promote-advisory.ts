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

// Advisory guard for the "epic link mistaken for triage/promotion" failure.
// BI-6C86ADEB (Scrum Master over-claim guard). Relates to EP-BUILD-STUDIO.
//
// Asked to "triage BI-X to build and promote it," a Scrum Master coworker
// edited the body and called link_backlog_item_to_epic(EP-BUILD-STUDIO), then
// reported "triaged as build and promoted into the Build Studio epic queue."
// But linking to an epic is purely organizational: triageOutcome stayed null,
// effortSize stayed null, and NO FeatureBuild was created. It conflated "linked
// to the Build Studio epic" with "triaged" and "promoted" — a
// structural-verification-is-not-functional violation.
//
// Like buildPromoteAdvisory, this is a NON-BLOCKING advisory attached to the
// successful link result, so prompt drift can't silently re-introduce the
// over-claim.

export type EpicLinkAdvisoryInput = {
  itemId: string;
  /** The semantic epic id the item is being linked to (null when unlinking). */
  targetEpicId: string | null;
  /** The item's triage outcome ("build" items go through Build Studio). */
  triageOutcome: string | null;
  /** Whether the item already has an active FeatureBuild linked. */
  hasActiveBuild: boolean;
};

/**
 * Return an advisory string when linking a backlog item to an epic could be
 * mistaken for triaging or promoting it — i.e. the item is being attached to an
 * epic while its triage/promotion work is genuinely unfinished. Returns null
 * for the common, unambiguous cases (unlinking, or an item that is already
 * triaged AND, if a build item, already has its build).
 */
export function buildEpicLinkAdvisory(
  input: EpicLinkAdvisoryInput,
): string | null {
  // Unlinking (or a no-op to no-epic) can't be confused with triage/promote.
  if (!input.targetEpicId) return null;

  const notTriaged = input.triageOutcome == null;
  const buildNotPromoted = input.triageOutcome === "build" && !input.hasActiveBuild;
  if (!notTriaged && !buildNotPromoted) return null;

  const next = notTriaged
    ? `This item is not triaged yet (triageOutcome is null). To triage it, use triage_backlog_item; ` +
      `if it triages to build, then use promote_to_build_studio to create the FeatureBuild and begin Ideate.`
    : `This item is triaged to build but has no FeatureBuild yet. To actually promote it, use ` +
      `promote_to_build_studio (which creates the FeatureBuild and begins Ideate).`;

  return (
    `Linking ${input.itemId} to ${input.targetEpicId} is organizational only — it does NOT triage the item, ` +
    `does NOT set a triageOutcome or effortSize, and does NOT create any build or engage Build Studio. ` +
    `${next} Do NOT report this epic link as "triaged" or "promoted".`
  );
}
