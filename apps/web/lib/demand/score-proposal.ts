// Pure demand-score proposer for the demand-scoring steward (BI-00C68162).
// No server imports, no model call: the same signals always yield the same
// proposal, which is what makes an agent-proposed score reviewable.
//
// What it proposes: RICE inputs on Intercom's published scales — reach (count
// per period), impact 3/2/1/0.5/0.25, confidence 100/80/50% — plus the effort
// denominator and an investment bucket. Every number carries a one-line basis.
//
// What it refuses to do:
// - propose over an owner. An item whose value inputs came from a human
//   (demandInputSource human|agreed) is never eligible, and present inputs are
//   kept, so the proposer only ever fills gaps (AC-2).
// - invent an effort size. No estimate and no t-shirt size means no proposal;
//   the item waits for a person rather than receiving a fabricated denominator.
// - claim certainty. A heuristic proposal tops out at 0.8 confidence (with
//   reviewed evidence) and starts at 0.5; 1.0 is reserved for an owner.
//
// The ranking that consumes these scores is a separate concern; this module only
// produces the inputs computeDemandScore (scoring.ts) already knows how to use.

import { type InvestmentBucket } from "../explore/backlog";
import { deriveBucket } from "./buckets";
import { resolveEstimateProvenance, firstPassJobSize } from "./estimate-provenance";

/** Statuses the steward scores: triaged work that has not closed. */
export const STEWARD_ELIGIBLE_STATUSES = ["open", "in-progress"] as const;

/** Intercom RICE impact ladder, lowest to highest. */
export const RICE_IMPACT_LADDER = [0.25, 0.5, 1, 2, 3] as const;

/** Heuristic confidence without and with reviewed evidence. */
export const STEWARD_PROPOSAL_BASE_CONFIDENCE = 0.5;
export const STEWARD_PROPOSAL_MAX_CONFIDENCE = 0.8;

export type ScoreProposalSignals = {
  itemId: string;
  title: string;
  body: string | null;
  status: string;
  workType: string | null;
  source: string | null;
  effortSize: string | null;
  occurrenceCount: number;
  investmentBucket: string | null;
  /** Status of the linked epic, or null when the item has none. */
  epicStatus: string | null;
  /** Active DemandEvidenceLink rows. */
  activeEvidenceCount: number;
  createdAt: Date;
  duplicateOfId: string | null;
  reach: number | null;
  impact: number | null;
  confidence: number | null;
  jobSize: number | null;
  demandScore: number | null;
  /** Who supplied the value inputs (EstimateSource), null when unattributed. */
  demandInputSource: string | null;
  estimateAiJobSize: number | null;
  estimateHumanJobSize: number | null;
  estimateAgreed: boolean | null;
};

export type DemandScoreProposal = {
  reach: number;
  impact: number;
  confidence: number;
  jobSize: number;
  /** Where the effort denominator came from. */
  jobSizeFrom: "existing" | "estimate" | "effortSize";
  investmentBucket: InvestmentBucket | null;
  basis: string[];
};

const OWNER_SOURCES = new Set(["human", "agreed"]);
const SEVERE = /\b(security|vulnerab\w*|data loss|corrupt\w*|outage|crash\w*|leak\w*|cannot|blocked|broken)\b/i;
const BASE_IMPACT_STEP: Record<string, number> = { bug: 2, feature: 2 };

function present(v: number | null): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** True when the steward may propose inputs for this item. */
export function isStewardEligible(s: ScoreProposalSignals): boolean {
  if (!(STEWARD_ELIGIBLE_STATUSES as readonly string[]).includes(s.status)) return false;
  if (s.duplicateOfId) return false;
  if (OWNER_SOURCES.has(s.demandInputSource ?? "")) return false;
  if (present(s.demandScore)) return false;
  // Both value inputs already present means someone scored it; leave it.
  if (present(s.impact) && present(s.confidence)) return false;
  return true;
}

/**
 * Likely value, for ordering the batch. Items in an in-flight epic, items a user
 * asked for, and bugs with live evidence come first; recurrence and evidence add
 * a little. Deterministic; ties are broken by selectStewardBatch.
 */
export function stewardPriority(s: ScoreProposalSignals): number {
  let p = 0;
  if (s.epicStatus === "in-progress") p += 4;
  else if (s.epicStatus === "open") p += 2;
  if (s.source === "user-request") p += 3;
  const liveSignal = s.activeEvidenceCount > 0 || s.occurrenceCount > 1;
  if (s.workType === "bug" && liveSignal) p += 3;
  p += Math.min(Math.max(s.occurrenceCount - 1, 0), 5);
  p += Math.min(s.activeEvidenceCount, 3);
  return p;
}

/** Eligible items, highest likely value first, oldest then id on ties, at most `limit`. */
export function selectStewardBatch<T extends ScoreProposalSignals>(rows: T[], limit: number): T[] {
  return rows
    .filter(isStewardEligible)
    .map((row) => ({ row, p: stewardPriority(row) }))
    .sort(
      (a, b) =>
        b.p - a.p ||
        a.row.createdAt.getTime() - b.row.createdAt.getTime() ||
        a.row.itemId.localeCompare(b.row.itemId),
    )
    .slice(0, Math.max(0, limit))
    .map((x) => x.row);
}

/**
 * Propose RICE inputs and a bucket for one item, or null when there is no honest
 * effort signal. Inputs already present are returned unchanged.
 */
export function proposeDemandScoreInputs(s: ScoreProposalSignals): DemandScoreProposal | null {
  const basis: string[] = [];

  // Effort first: without it there is nothing honest to divide by.
  const estimate = resolveEstimateProvenance({
    aiJobSize: s.estimateAiJobSize,
    humanJobSize: s.estimateHumanJobSize,
    agreed: s.estimateAgreed,
  });
  let jobSize: number;
  let jobSizeFrom: DemandScoreProposal["jobSizeFrom"];
  if (present(s.jobSize) && s.jobSize > 0) {
    jobSize = s.jobSize;
    jobSizeFrom = "existing";
    basis.push(`effort ${jobSize}: kept the recorded job size`);
  } else if (estimate.effectiveJobSize !== null && estimate.effectiveJobSize > 0) {
    jobSize = estimate.effectiveJobSize;
    jobSizeFrom = "estimate";
    basis.push(`effort ${jobSize}: the ${estimate.source ?? "recorded"} effort estimate`);
  } else {
    const fromSize = firstPassJobSize(s.effortSize);
    if (fromSize === null) return null;
    jobSize = fromSize;
    jobSizeFrom = "effortSize";
    basis.push(`effort ${jobSize}: projected from t-shirt size ${s.effortSize}`);
  }

  let reach: number;
  if (present(s.reach)) {
    reach = s.reach;
    basis.push(`reach ${reach}: kept the recorded reach`);
  } else {
    reach = Math.max(1, s.occurrenceCount) + Math.max(0, s.activeEvidenceCount);
    basis.push(
      `reach ${reach}: ${Math.max(1, s.occurrenceCount)} occurrence(s) + ${s.activeEvidenceCount} reviewed evidence link(s)`,
    );
  }

  let impact: number;
  if (present(s.impact)) {
    impact = s.impact;
    basis.push(`impact ${impact}: kept the recorded impact`);
  } else {
    let step = BASE_IMPACT_STEP[s.workType ?? ""] ?? 1;
    const why: string[] = [`${s.workType ?? "unspecified"} work`];
    if (s.source === "user-request") {
      step += 1;
      why.push("a user asked for it");
    }
    if (s.workType === "bug" && SEVERE.test(`${s.title}\n${s.body ?? ""}`)) {
      step += 1;
      why.push("the report names a severe failure");
    }
    if (s.epicStatus === "in-progress") {
      step += 1;
      why.push("its epic is in flight");
    }
    step = Math.min(step, RICE_IMPACT_LADDER.length - 1);
    impact = RICE_IMPACT_LADDER[step]!;
    basis.push(`impact ${impact}: ${why.join(", ")}`);
  }

  let confidence: number;
  if (present(s.confidence)) {
    confidence = s.confidence;
    basis.push(`confidence ${confidence}: kept the recorded confidence`);
  } else if (s.activeEvidenceCount > 0) {
    confidence = STEWARD_PROPOSAL_MAX_CONFIDENCE;
    basis.push(`confidence ${confidence}: heuristic proposal backed by reviewed evidence`);
  } else {
    confidence = STEWARD_PROPOSAL_BASE_CONFIDENCE;
    basis.push(`confidence ${confidence}: heuristic proposal with no reviewed evidence`);
  }

  const kept = s.investmentBucket as InvestmentBucket | null;
  const investmentBucket = kept ?? deriveBucket(s.workType);
  if (kept) basis.push(`bucket ${kept}: kept the recorded bucket`);
  else if (investmentBucket) basis.push(`bucket ${investmentBucket}: derived from work type ${s.workType}`);
  else basis.push("bucket left for the owner: work type does not map to Run/Grow/Transform");

  return { reach, impact, confidence, jobSize, jobSizeFrom, investmentBucket, basis };
}
