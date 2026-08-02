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

  it("parses severity-driven results and fails closed on malformed output", () => {
    expect(parseSemanticReviewResponse('{"decision":"fail","issues":[{"severity":"important","description":"advisory"}],"summary":"ok"}').decision).toBe("pass");
    const malformed = parseSemanticReviewResponse("not json");
    expect(malformed.decision).toBe("inconclusive");
    expect(malformed.issues).toEqual([]);
    expect(malformed.inconclusiveReason).toBe("unparseable-review-response");
    expect(malformed.parseError).toBe(true);
  });
});
