import { describe, expect, it } from "vitest";
import { FAILURE_ANALYSIS_CHALLENGE_ISSUE, blockingSemanticFailure } from "./semantic-review-supersession";

const identity = { sourceHeadSha: "c".repeat(40), headTreeHash: "a".repeat(40), diffDigest: "b".repeat(64) };
const faOnlyFail = (at: string) => ({ id: `fail-${at}`, createdAt: new Date(at), details: { ...identity, result: {
  decision: "fail", failureAnalysisReview: { adequate: false, rationale: "The analysis omits two disclosed measurement gaps." },
  issues: [{ severity: "warning", description: "advisory" }, { severity: "critical", description: FAILURE_ANALYSIS_CHALLENGE_ISSUE }],
} } });
const codeFail = (at: string) => ({ id: `code-${at}`, createdAt: new Date(at), details: { ...identity, result: {
  decision: "fail", failureAnalysisReview: { adequate: true, rationale: "Adequate analysis of the changed behaviour." },
  issues: [{ severity: "critical", description: "The refusal path writes the job before checking authority." }],
} } });
const pass = (at: string, over: Record<string, unknown> = {}) => ({ id: `pass-${at}`, createdAt: new Date(at), details: { ...identity, ...over, result: {
  decision: "pass", failureAnalysisReview: { adequate: true, rationale: "Scenarios now cover the disclosed gaps and recovery." }, issues: [],
} } });

describe("a passing repair supersedes a failure-analysis-only fail on the same change (BI-38C51AF2)", () => {
  it("does not block when a later pass on the same head, tree and diff follows a failure-analysis-only fail", () => {
    expect(blockingSemanticFailure([faOnlyFail("2026-11-05T05:10:00Z"), pass("2026-11-05T05:14:00Z")])).toBeNull();
  });

  it("ignores row order", () => {
    expect(blockingSemanticFailure([pass("2026-11-05T05:14:00Z"), faOnlyFail("2026-11-05T05:10:00Z")])).toBeNull();
  });

  it("keeps blocking on a code finding even after a later pass", () => {
    expect(blockingSemanticFailure([codeFail("2026-11-05T05:10:00Z"), pass("2026-11-05T05:14:00Z")])).toEqual({ id: "code-2026-11-05T05:10:00Z" });
  });

  it("keeps blocking a failure-analysis-only fail with no later pass", () => {
    expect(blockingSemanticFailure([faOnlyFail("2026-11-05T05:10:00Z")])).toEqual({ id: "fail-2026-11-05T05:10:00Z" });
    expect(blockingSemanticFailure([pass("2026-11-05T05:05:00Z"), faOnlyFail("2026-11-05T05:10:00Z")])).toEqual({ id: "fail-2026-11-05T05:10:00Z" });
  });

  it.each([
    ["a different tree", { headTreeHash: "d".repeat(40) }],
    ["a different diff", { diffDigest: "e".repeat(64) }],
    ["a different head", { sourceHeadSha: "f".repeat(40) }],
  ])("does not let a pass on %s supersede", (_label, over) => {
    expect(blockingSemanticFailure([faOnlyFail("2026-11-05T05:10:00Z"), pass("2026-11-05T05:14:00Z", over)])).not.toBeNull();
  });

  it("does not treat a pass with an inadequate failure-analysis review as a repair", () => {
    const weak = pass("2026-11-05T05:14:00Z");
    (weak.details.result as { failureAnalysisReview: { adequate: boolean } }).failureAnalysisReview.adequate = false;
    expect(blockingSemanticFailure([faOnlyFail("2026-11-05T05:10:00Z"), weak])).not.toBeNull();
  });

  it("treats a fail that mixes the failure-analysis challenge with a code finding as blocking", () => {
    const mixed = faOnlyFail("2026-11-05T05:10:00Z");
    mixed.details.result.issues.push({ severity: "critical", description: "Data loss on retry." });
    expect(blockingSemanticFailure([mixed, pass("2026-11-05T05:14:00Z")])).not.toBeNull();
  });

  it("returns null when there is no fail at all, and ignores malformed rows", () => {
    expect(blockingSemanticFailure([pass("2026-11-05T05:14:00Z"), { id: "x", createdAt: new Date(), details: null }])).toBeNull();
  });
});
