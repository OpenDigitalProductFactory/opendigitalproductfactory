// Phase 3 of the weekly decision-engine review (BI-19CEC4B4): each finding
// reaches the scope that owns it.
//
// Phase 2 measured the engine and wrote the digest to the run log, which the
// founder's own framing already rules out — "presenting to the right human what
// may / should be changed". A console line presents nothing to anyone.
//
// WHY NO NEW SUBSTRATE. `DecisionResolutionProposal` already exists for exactly
// this shape: a drafted resolution an owner rules on, with a lifecycle, a
// `gap-cluster` scope for "every unanswered decision in a domain", and a store
// that refuses to duplicate an open proposal or reopen a settled one. It has
// been empty since it shipped. The weekly review is its first writer.
//
// ROUTING IS BY SCOPE, NOT BY CONVENIENCE. `decisions-belong-to-their-scope`
// forbids one scope answering another's question, and it equally forbids
// handing one scope's *findings* to another owner. A starved craft corpus is
// the craft's problem to fix, not the founder's; a missing business stance is
// the organization's. So the owning profile is derived from the line's scope
// and nothing else.

import {
  WWMD_PLATFORM_PROFILE_ID,
  WWWD_ORGANIZATION_PROFILE_ID,
} from "@/lib/decision/caller-context";
import { professionProfileId } from "@/lib/decision-perspective/resolve-profession-profile";
import {
  createResolutionProposal,
  type ProposalActionKind,
  type ProposalClient,
  type ProposalDissent,
} from "@/lib/decision/resolution-proposal-store";

import type { ReviewLine, ReviewProposedAction } from "./measures";

/**
 * A deterministic measure convenes no panel, and the schema is explicit that
 * "nobody dissented" and "nobody asked" must never read the same on the card.
 * An empty array would claim a panel agreed. This says plainly that there was
 * none, so a reader knows the number is arithmetic rather than judgement.
 */
export const NO_PANEL_DISSENT: readonly ProposalDissent[] = [
  {
    role: "none-convened",
    position: "No panel was asked; this finding is a measurement, not a verdict.",
    because:
      "The weekly review is deterministic SQL over the decision ledger. The judgement about what to do belongs to the owner ruling on this proposal.",
  },
];

/**
 * Only actions that are genuinely a governance ruling become proposals.
 *
 * `file-defect` is deliberately absent. A defect is engineering work, and
 * auto-filing backlog items from a weekly measure would put a duplicate in the
 * pool every week the defect stayed open. Those lines are reported for a human
 * to file, and the count is returned so they cannot be silently dropped.
 */
const ACTION_BY_PROPOSAL: Partial<Record<ReviewProposedAction, ProposalActionKind>> = {
  "confirm-material": "release_material",
  "publish-craft-page": "answer_gap",
  "examine-weight": "adjust_weight",
  "capture-stance": "amend_stance",
};

/**
 * Namespaced so a review finding can never collide with a real decision's
 * domainClass (`architecture-tradeoff` and friends) in the proposal's unique
 * key, which is built from profileId + domainClass.
 */
export function reviewDomainClass(line: ReviewLine): string {
  return line.professionKey
    ? `review:${line.measureKey}:${line.professionKey}`
    : `review:${line.measureKey}`;
}

/** The profile that owns this scope, and therefore owns the finding. */
export function ownerProfileIdForLine(line: ReviewLine): string | null {
  switch (line.scope) {
    case "wwmd":
      return WWMD_PLATFORM_PROFILE_ID;
    case "wwwd":
      return WWWD_ORGANIZATION_PROFILE_ID;
    case "wsid":
      // A craft finding with no craft named has no owner to route to; that is a
      // measure defect, and inventing an owner would hide it.
      return line.professionKey ? professionProfileId(line.professionKey) : null;
    default:
      return null;
  }
}

export type RoutedFinding = {
  lineKey: string;
  profileId: string;
  domainClass: string;
  actionKind: ProposalActionKind;
  proposalId: string | null;
  /** "created" | "already-open" | "already-ruled" | "unroutable" | "error" */
  outcome: string;
};

export type RoutingSummary = {
  created: number;
  /** A finding still open from a previous week — correct, not a failure. */
  alreadyOpen: number;
  /** The owner already ruled; a later run does not reopen a settled question. */
  alreadyRuled: number;
  /** Lines needing a defect filed by a human, deliberately not auto-filed. */
  needsDefectFiled: number;
  /** Lines whose scope named no owner — a measure defect, surfaced not hidden. */
  unroutable: number;
  routed: RoutedFinding[];
};

export function emptyRoutingSummary(): RoutingSummary {
  return {
    created: 0,
    alreadyOpen: 0,
    alreadyRuled: 0,
    needsDefectFiled: 0,
    unroutable: 0,
    routed: [],
  };
}

/**
 * Draft one proposal per actionable finding, addressed to the owning scope.
 *
 * Re-running in the same or a later week is safe: the proposal's unique key is
 * (profile, namespaced measure), so an unresolved finding stays ONE open
 * proposal rather than accumulating a new card every Monday. The consequence is
 * deliberate — a finding whose numbers worsen does not rewrite an open
 * proposal, because the owner has not yet ruled on the first one and silently
 * editing the card under them would be worse than leaving it.
 */
export async function routeReviewFindings(input: {
  db: ProposalClient;
  lines: readonly ReviewLine[];
  periodKey: string;
}): Promise<RoutingSummary> {
  const summary = emptyRoutingSummary();

  for (const line of input.lines) {
    if (line.proposedAction === "no-action") continue;

    if (line.proposedAction === "file-defect") {
      summary.needsDefectFiled += 1;
      summary.routed.push({
        lineKey: line.lineKey,
        profileId: ownerProfileIdForLine(line) ?? "",
        domainClass: reviewDomainClass(line),
        actionKind: "no_change",
        proposalId: null,
        outcome: "needs-defect-filed",
      });
      continue;
    }

    const actionKind = ACTION_BY_PROPOSAL[line.proposedAction];
    const profileId = ownerProfileIdForLine(line);
    if (!actionKind || !profileId) {
      summary.unroutable += 1;
      summary.routed.push({
        lineKey: line.lineKey,
        profileId: profileId ?? "",
        domainClass: reviewDomainClass(line),
        actionKind: "no_change",
        proposalId: null,
        outcome: "unroutable",
      });
      continue;
    }

    const domainClass = reviewDomainClass(line);
    const result = await createResolutionProposal(input.db, {
      scopeKind: "gap_cluster",
      domainClass,
      profileId,
      actionKind,
      draftPayload: {
        source: "decision-engine-review",
        periodKey: input.periodKey,
        lineKey: line.lineKey,
        measureKey: line.measureKey,
        scope: line.scope,
        professionKey: line.professionKey,
        evidence: line.evidence,
      },
      summary: `${line.headline} (weekly decision-engine review ${input.periodKey})`,
      dissent: [...NO_PANEL_DISSENT],
      confidence: null,
    }).catch(() => null);

    const outcome = !result
      ? "error"
      : result.ok
      ? "created"
      : result.error === "already-ruled"
      ? "already-ruled"
      : result.error === "already-open"
      ? "already-open"
      : result.error;

    if (outcome === "created") summary.created += 1;
    else if (outcome === "already-open") summary.alreadyOpen += 1;
    else if (outcome === "already-ruled") summary.alreadyRuled += 1;

    summary.routed.push({
      lineKey: line.lineKey,
      profileId,
      domainClass,
      actionKind,
      proposalId: result?.ok ? result.data.proposalId : null,
      outcome,
    });
  }

  return summary;
}

/** One log line, so the routing outcome is legible without a DB query. */
export function describeRouting(summary: RoutingSummary): string {
  return [
    `${summary.created} created`,
    `${summary.alreadyOpen} already open`,
    `${summary.alreadyRuled} already ruled`,
    `${summary.needsDefectFiled} needing a defect filed`,
    `${summary.unroutable} unroutable`,
  ].join(", ");
}
