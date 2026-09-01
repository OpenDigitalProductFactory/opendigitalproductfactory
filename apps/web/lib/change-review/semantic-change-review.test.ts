import { describe, expect, it } from "vitest";
import {
  CHANGE_REVIEW_POLICY_VERSION,
  CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION,
  assessSemanticReviewReceiptFreshness,
  buildSemanticChangeReviewPrompt,
  createLowRiskAutoPassReceipt,
  createSemanticReviewReceipt,
  parseSemanticReviewResponse,
  projectSemanticReviewReceipt,
  type SemanticReviewIdentity,
} from "./semantic-change-review";

const identity = (overrides: Partial<SemanticReviewIdentity> = {}): SemanticReviewIdentity => ({
  capsuleId: "WC-12345678",
  baseTreeHash: "tree-base",
  headTreeHash: "tree-head",
  diffDigest: "sha256:diff-a",
  policyVersion: CHANGE_REVIEW_POLICY_VERSION,
  reviewerVersion: "change-reviewer.v1",
  specialistIds: ["security-reviewer", "architecture-reviewer"],
  ...overrides,
});

describe("semantic review receipt freshness", () => {
  const reviewedReceipt = () => createSemanticReviewReceipt({
    identity: identity(),
    disposition: "reviewed",
    risk: "high",
    result: { decision: "pass", issues: [], summary: "No blocking findings." },
  });

  it("is stable for the same semantic change and normalized specialist set", () => {
    const receipt = reviewedReceipt();
    const result = assessSemanticReviewReceiptFreshness(receipt, identity({
      specialistIds: ["architecture-reviewer", "security-reviewer", "security-reviewer"],
    }));

    expect(result).toEqual({ fresh: true, reasons: [] });
    expect(receipt.schemaVersion).toBe(CHANGE_REVIEW_RECEIPT_SCHEMA_VERSION);
  });

  it.each([
    ["code-change", { diffDigest: "sha256:diff-b", headTreeHash: "tree-head-b" }, ["head-tree-changed", "diff-changed"]],
    ["rebase", { baseTreeHash: "tree-base-b" }, ["base-tree-changed"]],
    ["policy", { policyVersion: "semantic-change-review.v2" }, ["policy-version-changed"]],
    ["reviewer", { reviewerVersion: "change-reviewer.v2" }, ["reviewer-version-changed"]],
    ["specialists", { specialistIds: ["security-reviewer"] }, ["specialist-set-changed"]],
  ] as const)("invalidates after a %s change", (_label, overrides, expectedReasons) => {
    const result = assessSemanticReviewReceiptFreshness(reviewedReceipt(), identity(overrides));
    expect(result.fresh).toBe(false);
    expect(result.reasons).toEqual(expectedReasons);
  });
});

describe("semantic review evidence", () => {
  it("creates auditable low-risk auto-pass evidence instead of silently skipping", () => {
    const receipt = createLowRiskAutoPassReceipt({
      identity: identity(),
      rationale: "Documentation-only change is below the independent-review threshold.",
    });
    const projection = projectSemanticReviewReceipt(receipt);

    expect(receipt.disposition).toBe("auto-pass");
    expect(receipt.result.decision).toBe("pass");
    expect(receipt.risk).toBe("low");
    expect(projection.externalEvidence.operationType).toBe("semantic-change-review.receipt");
    expect(projection.externalEvidence.details).toEqual(receipt);
    expect(projection.activity.kind).toBe("evidence-recorded");
    expect(projection.activity.payload).toEqual(receipt);
  });
});

describe("surface-neutral review compatibility", () => {
  it("builds a surface-neutral code-review prompt contract", () => {
    const prompt = buildSemanticChangeReviewPrompt({
      title: "Add filter",
      artifact: "const x = 1;",
      verificationEvidence: "PASS 1 test",
    });
    expect(prompt).toContain("CHANGE: Add filter");
    expect(prompt).toContain("CODE CHANGES:\nconst x = 1;");
    expect(prompt).toContain("VERIFICATION EVIDENCE:\nPASS 1 test");
  });

  // BI-82902891: a reviewer that cannot see the change had no way to say so.
  // The response contract offered only pass|fail and the decision was derived
  // from severity alone, so "I could not see the code" arrived as an `important`
  // issue and aggregated into a PASS — on a change the reviewer never read.
  it("treats a reviewer that cannot verify the change as inconclusive, never pass", () => {
    const result = parseSemanticReviewResponse(JSON.stringify({
      decision: "cannot-verify",
      issues: [{
        severity: "important",
        description: "The committed tree available for review does not contain the claimed change.",
      }],
      summary: "Could not review: the artifact was not present in the reviewed tree.",
    }));

    expect(result.decision).toBe("inconclusive");
    expect(result.inconclusiveReason).toBe("reviewer-could-not-verify-change");
    // Not a parse failure — the reviewer answered correctly, it just could not see the change.
    expect(result.parseError).toBeUndefined();
    // The reviewer's own account of why is preserved for the operator.
    expect(result.issues).toHaveLength(1);
    expect(result.summary).toContain("not present");
  });

  it("accepts the underscore spelling of cannot_verify", () => {
    const result = parseSemanticReviewResponse('{"decision":"cannot_verify","issues":[],"summary":"no artifact"}');
    expect(result.decision).toBe("inconclusive");
    expect(result.inconclusiveReason).toBe("reviewer-could-not-verify-change");
  });

  it("still refuses to publish a cannot-verify receipt in enforce mode", () => {
    // The inconclusive channel already fails closed downstream; this pins that a
    // cannot-verify verdict rides it rather than the pass path.
    const result = parseSemanticReviewResponse('{"decision":"cannot-verify","issues":[],"summary":"no artifact"}');
    expect(result.decision).not.toBe("pass");
  });

  it("offers the cannot-verify channel in the prompt contract", () => {
    const prompt = buildSemanticChangeReviewPrompt({
      title: "t", artifact: "a", verificationEvidence: "e",
    });
    expect(prompt).toContain("cannot-verify");
    // The reviewer must be told this is NOT a code finding, which is the
    // misgrading that produced the false pass.
    expect(prompt.toLowerCase()).toContain("not a code issue");
  });

  // The verbatim shape of the BI-82902891 incident: the reviewer answered "pass"
  // and filed its inability to see the change as an `important` finding, because
  // the cannot-verify channel did not exist yet. A model that ignores the new
  // channel must not be able to reproduce that false pass.
  it("refuses to pass when the findings themselves say the change was not in the reviewed tree", () => {
    const result = parseSemanticReviewResponse(JSON.stringify({
      decision: "pass",
      issues: [{
        severity: "important",
        description: "Receipt integrity failure: the committed tree available for review does not contain the claimed change.",
      }],
      summary: "2 independent review branches completed; 0 blocking findings.",
    }));

    expect(result.decision).toBe("inconclusive");
    expect(result.inconclusiveReason).toBe("reviewer-could-not-verify-change");
  });

  it("does not trip the integrity net on an ordinary finding that happens to say 'not present'", () => {
    const result = parseSemanticReviewResponse(JSON.stringify({
      decision: "pass",
      issues: [{
        severity: "minor",
        description: "A loading state is not present on the submit button.",
      }],
      summary: "Reviewed; one minor nit.",
    }));

    expect(result.decision).toBe("pass");
    expect(result.inconclusiveReason).toBeUndefined();
  });

  it("parses severity-driven results and fails closed on malformed output", () => {
    expect(parseSemanticReviewResponse('{"decision":"fail","issues":[{"severity":"important","description":"advisory"}],"summary":"ok"}').decision).toBe("pass");
    const malformed = parseSemanticReviewResponse("not json");
    expect(malformed.decision).toBe("inconclusive");
    expect(malformed.issues).toEqual([]);
    expect(malformed.inconclusiveReason).toBe("unparseable-review-response");
    expect(malformed.parseError).toBe(true);
  });
});
