import { describe, expect, it } from "vitest";
import { readSemanticReviewBudget, semanticReviewRecoveryBudget, semanticReviewRecoveryObservation } from "./semantic-review-recovery-policy";
const now = Date.parse("2026-09-13T00:00:00Z");
const future = "2026-09-13T00:10:00Z";
describe("recorded reviewer recovery budget", () => {
  it("shares versioned budget extraction without inventing corrupt counters", () => {
    expect(readSemanticReviewBudget({ semanticReview: { schemaVersion: 1, deadlineAt: future } }))
      .toEqual({ deadlineAt: future, recoveryAttempt: 0 });
    expect(readSemanticReviewBudget({ semanticReview: { schemaVersion: 2, deadlineAt: future, recoveryAttempt: 1 } }))
      .toEqual({ deadlineAt: null, recoveryAttempt: null });
    expect(readSemanticReviewBudget({ semanticReview: { schemaVersion: 1, deadlineAt: future, recoveryAttempt: "1" } }))
      .toEqual({ deadlineAt: future, recoveryAttempt: null });
    expect(readSemanticReviewBudget({ semanticReview: { schemaVersion: 1, deadlineAt: future, recoveryAttempt: null } }))
      .toEqual({ deadlineAt: future, recoveryAttempt: null });
  });
  it("allows remaining budget without claiming actor authority", () => {
    expect(semanticReviewRecoveryBudget(future, 2, now)).toBe("available");
    expect(semanticReviewRecoveryBudget(future, undefined, now)).toBe("available");
  });
  it("expires at the immutable deadline", () => {
    expect(semanticReviewRecoveryBudget(new Date(now).toISOString(), 0, now)).toBe("expired");
  });
  it.each([null, undefined, "invalid", 0])("reports unknown deadline %s", (deadline) => {
    expect(semanticReviewRecoveryBudget(deadline, 0, now)).toBe("unknown");
  });
  it.each([3, 4])("refuses exhausted counter %s", (counter) => {
    expect(semanticReviewRecoveryBudget(future, counter, now)).toBe("exhausted");
  });
  it.each([-1, 0.5, "1", null])("reports corrupt counter %s as unknown", (counter) => {
    expect(semanticReviewRecoveryBudget(future, counter, now)).toBe("unknown");
  });
});


describe("review recovery status", () => {
  it("names eligibility remediation instead of recommending an unchanged inference retry", () => {
    const view = semanticReviewRecoveryObservation("input-required", { semanticReview: {
      schemaVersion: 1, deadlineAt: future, reason: "review-endpoint-ineligible", recoveryAttempt: 0,
      routingEligibility: [{ sensitivity: "restricted", residencyPolicy: "local_only", excludedCount: 2,
        exclusions: [{ bucket: "output-capacity", count: 2 }] }],
    } }, now);
    expect(view.classification).toBe("routing-blocked");
    expect(view.nextAction).toContain("eligibility");
    expect(view.nextAction).not.toContain("then confirm retry");
    expect(view.pollUseful).toBe(false);
    expect(view.eligibility).toHaveLength(1);
  });
  it.each([
    ["submitted", "active-execution", true], ["working", "active-execution", true],
    ["auth-required", "authorization-required", false], ["completed", "completed", false],
    ["canceled", "canceled", false], ["input-required", "execution-uncertain", false],
  ])("distinguishes %s without treating it as a verdict", (status, classification, pollUseful) => {
    expect(semanticReviewRecoveryObservation(status as string, { semanticReview: {
      schemaVersion: 1, deadlineAt: future, reason: "provider-outcome-uncertain", recoveryAttempt: 1,
    } }, now)).toMatchObject({ classification, pollUseful });
  });
  it.each([
    [future, 0], [new Date(now - 1).toISOString(), 0], [future, 3], [null, null],
  ])("keeps unknown execution proof ahead of budget %s/%s", (deadlineAt, recoveryAttempt) => {
    for (const uncertainty of [{ executionOutcome: "unknown" }, { reason: "provider-outcome-uncertain:lost-response" }]) {
      const view = semanticReviewRecoveryObservation("input-required", { semanticReview: {
        schemaVersion: 1, deadlineAt, recoveryAttempt, ...uncertainty,
      } }, now);
      expect(view.classification).toBe("execution-uncertain");
      expect(view.nextAction).toContain("execution settlement");
      expect(view.nextAction).not.toContain("bounded successor");
      expect(view.nextAction).not.toContain("confirm retry_semantic_review");
      expect(view.pollUseful).toBe(false);
    }
  });
  it("keeps uncertainty ahead of simultaneous routing remediation", () => {
    const view = semanticReviewRecoveryObservation("input-required", { semanticReview: {
      schemaVersion: 1, deadlineAt: future, recoveryAttempt: 0,
      executionOutcome: "unknown", reason: "review-endpoint-ineligible",
    } }, now);
    expect(view.classification).toBe("execution-uncertain");
    expect(view.nextAction).toContain("execution settlement");
  });
  it("does not offer an unlimited chain or expose a corrupt digest", () => {
    const view = semanticReviewRecoveryObservation("input-required", { semanticReview: {
      schemaVersion: 1, deadlineAt: new Date(now - 1).toISOString(), successorAttempt: 1,
      recoveryAttempt: -1, requestDigest: "private data",
    } }, now);
    expect(view.nextAction).toContain("cannot renew again");
    expect(view.requestDigest).toBeNull();
    expect(view.remainingAttempts).toBeNull();
  });
});
