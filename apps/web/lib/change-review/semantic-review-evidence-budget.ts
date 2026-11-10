// The semantic review packet's evidence budget (BI-FD7DE19D).
//
// The prompt embedded each resolved evidence row whole, and a local-CI row's
// `observed` is the gate log, up to 12,000 characters. The reviewer cannot act
// on a gate log beyond its verdict, yet it is billed against the one window the
// review must fit. Measured on DEV 2026-11-03 (PR #6875): an 80,694-character
// prompt needed 42,051 tokens against the 40,960-token local reviewer, the only
// endpoint cleared for confidential review, and every review ended
// `review-endpoint-ineligible`; Failure Readiness then held every PR.
//
// Evidence prose is trimmed first and deterministically: a long `observed`
// becomes a pointer (sha256 and length of the full text) plus its tail, where a
// gate prints its verdict. The diff is never trimmed — the server already binds
// the artifact to its digest — so a change too large on its own fails closed and
// says so (`endpointIneligibleSummary`).

import { createHash } from "node:crypto";
import type { RoutingEligibility } from "../inference/routing-exclusion-buckets";

/** The tail of a long observed output the reviewer still sees. */
export const REVIEW_EVIDENCE_OBSERVED_EXCERPT_CHARS = 1_500;

type EvidenceRow = { observed?: unknown };

/** Each row with a long `observed` replaced by a digest-bound pointer. Pure. */
export function boundReviewEvidence<T extends EvidenceRow>(rows: readonly T[] | null | undefined): Array<T | Record<string, unknown>> {
  return (rows ?? []).map((row) => {
    const observed = row.observed;
    if (typeof observed !== "string" || observed.length <= REVIEW_EVIDENCE_OBSERVED_EXCERPT_CHARS) return row;
    const { observed: _full, ...rest } = row;
    return {
      ...rest,
      observedChars: observed.length,
      observedSha256: createHash("sha256").update(observed).digest("hex"),
      observedExcerpt: observed.slice(-REVIEW_EVIDENCE_OBSERVED_EXCERPT_CHARS),
    };
  });
}

const GENERIC_INELIGIBLE = "No endpoint meets the review's routing requirements. No provider dispatch began for this branch.";

/**
 * The branch summary for a review no endpoint could take. When a context
 * window excluded a reviewer, the packet is larger than what the data boundary
 * allows after evidence was already bounded, so the next action belongs to the
 * author: a smaller change. Retrying the same packet cannot help.
 */
export function endpointIneligibleSummary(eligibility: readonly RoutingEligibility[]): string {
  const contextBound = eligibility.some((entry) => entry.exclusions.some((item) => item.bucket === "context-window"));
  return contextBound
    ? `${GENERIC_INELIGIBLE} The review packet is larger than the largest eligible reviewer context; its evidence is already bounded and the diff is never trimmed. Next action (change author): split the change into smaller pull requests.`
    : GENERIC_INELIGIBLE;
}
