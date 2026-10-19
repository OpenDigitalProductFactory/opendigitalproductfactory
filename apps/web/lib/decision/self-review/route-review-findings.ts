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

import type { ReviewLine } from "./measures";

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
 * What the review knows about the install beyond the ledger, resolved by the
 * caller so this module stays free of I/O (BI-1A2FD647).
 *
 * A proposal is written only when the owner can actually accept it: every
 * payload names the thing its write-through changes. Before this, every card
 * the review wrote was refused on accept, because the router named actions
 * whose inputs it never supplied.
 */
export type RoutingFacts = {
  /** `wsid-` profiles holding high-stakes material awaiting a person's release. */
  heldMaterialProfileIds: ReadonlySet<string>;
  /** The open weight-adjustment proposal for each decision class, if any. */
  openWeightProposalByDomainClass: ReadonlyMap<string, string>;
  /**
   * Nominate a craft corpus gap to the craft's own coworker. Growing a corpus
   * is not destructive, irreversible or regulated, so by the founder's
   * 2026-09-24 doctrine it is a coworker's job, not a card in a person's queue.
   * Absent means nomination is unavailable and the line is only reported.
   */
  nominateCorpusGap?: (input: {
    professionKey: string;
    domainClass: string;
    headline: string;
  }) => Promise<{ nominated: boolean; reason?: string; needId?: string }>;
};

export const NO_ROUTING_FACTS: RoutingFacts = {
  heldMaterialProfileIds: new Set(),
  openWeightProposalByDomainClass: new Map(),
};

/**
 * How one finding is resolved: a proposal an owner can accept, a nomination
 * to the craft's coworker, or a line reported with the reason nothing was
 * written.
 *
 * `file-defect` never becomes a proposal. A defect is engineering work, and
 * auto-filing backlog items from a weekly measure would put a duplicate in the
 * pool every week the defect stayed open.
 */
type FindingPlan =
  | { kind: "proposal"; actionKind: ProposalActionKind; payload: Record<string, unknown> }
  | { kind: "nominate"; professionKey: string; domainClass: string }
  | { kind: "report"; reason: string };

function stringEvidence(line: ReviewLine, key: string): string | null {
  const value = line.evidence[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function planFinding(line: ReviewLine, profileId: string, facts: RoutingFacts): FindingPlan {
  const craft = line.scope === "wsid" && line.professionKey ? line.professionKey : null;
  switch (line.proposedAction) {
    case "confirm-material":
      // Held material is the one craft release a person owns: it was held
      // because its family touches finance or compliance.
      if (craft && facts.heldMaterialProfileIds.has(profileId)) {
        return { kind: "proposal", actionKind: "release_material", payload: { profileId } };
      }
      if (craft) {
        return { kind: "nominate", professionKey: craft, domainClass: stringEvidence(line, "domainClass") ?? "all-decision-classes" };
      }
      return { kind: "report", reason: "platform doctrine is curated by its owner; no automated writer grows it" };
    case "publish-craft-page":
      return craft
        ? { kind: "nominate", professionKey: craft, domainClass: stringEvidence(line, "domainClass") ?? "all-decision-classes" }
        : { kind: "report", reason: "no craft named to publish for" };
    case "examine-weight": {
      const domainClass = stringEvidence(line, "domainClass");
      const weightProposalId = domainClass ? facts.openWeightProposalByDomainClass.get(domainClass) : undefined;
      return weightProposalId
        ? { kind: "proposal", actionKind: "adjust_weight", payload: { weightProposalId } }
        : { kind: "report", reason: "no open weight proposal for this decision class to rule on" };
    }
    case "capture-stance": {
      // The owner answers the question their decisions keep repeating. The
      // answer is theirs to write, so the draft carries the question only.
      const question = stringEvidence(line, "sample");
      return question
        ? { kind: "proposal", actionKind: "answer_gap", payload: { question, answer: "" } }
        : { kind: "report", reason: "the repeated question was not recorded" };
    }
    default:
      return { kind: "report", reason: `no resolution for ${line.proposedAction}` };
  }
}

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
  /** Craft corpus gaps handed to the craft's coworker instead of a person. */
  nominated: number;
  /** Lines with nothing an owner could accept; the reason is on the routed entry. */
  reported: number;
  routed: RoutedFinding[];
};

export function emptyRoutingSummary(): RoutingSummary {
  return {
    created: 0,
    alreadyOpen: 0,
    alreadyRuled: 0,
    needsDefectFiled: 0,
    unroutable: 0,
    nominated: 0,
    reported: 0,
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
  facts?: RoutingFacts;
}): Promise<RoutingSummary> {
  const facts = input.facts ?? NO_ROUTING_FACTS;
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

    const profileId = ownerProfileIdForLine(line);
    if (!profileId) {
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
    const plan = planFinding(line, profileId, facts);

    if (plan.kind === "nominate") {
      const nomination = facts.nominateCorpusGap
        ? await facts.nominateCorpusGap({
          professionKey: plan.professionKey,
          domainClass: plan.domainClass,
          headline: line.headline,
        }).catch(() => null)
        : null;
      const opened = Boolean(nomination && (nomination.nominated || nomination.reason === "duplicate-open-need"));
      if (opened) summary.nominated += 1;
      else summary.reported += 1;
      summary.routed.push({
        lineKey: line.lineKey,
        profileId,
        domainClass,
        actionKind: "no_change",
        proposalId: null,
        outcome: opened
          ? `nominated${nomination?.needId ? `:${nomination.needId}` : ""}`
          : `reported:${nomination?.reason ?? "nomination unavailable"}`,
      });
      continue;
    }
    if (plan.kind === "report") {
      summary.reported += 1;
      summary.routed.push({
        lineKey: line.lineKey,
        profileId,
        domainClass,
        actionKind: "no_change",
        proposalId: null,
        outcome: `reported:${plan.reason}`,
      });
      continue;
    }

    const actionKind = plan.actionKind;
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
        // What the write-through reads on accept (BI-1A2FD647).
        ...plan.payload,
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
    `${summary.nominated} nominated to a craft coworker`,
    `${summary.reported} reported`,
  ].join(", ");
}
