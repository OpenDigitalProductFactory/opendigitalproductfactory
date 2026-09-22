import { describe, expect, it } from "vitest";
import { readSemanticReviewBudget, semanticReviewRecoveryBudget } from "./semantic-review-recovery-policy";
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
