import { describe, expect, it } from "vitest";
import { AgentBudgetExhaustedError } from "@/lib/routing/inference-error";
import { semanticReviewBudgetRefusal, semanticReviewBudgetRefusalAction } from "./semantic-review-budget-refusal";
import { semanticReviewReasonLabel } from "./semantic-review-presentation";
import { semanticReviewRecoveryObservation } from "./semantic-review-recovery-policy";

const refusal = new AgentBudgetExhaustedError("change-reviewer", 214_206, 200_000, "2026-11-05T00:00:00.000Z", "local");

describe("a reviewer budget refusal is reported as itself (BI-F3B6713F)", () => {
  it("finds the typed refusal behind the fallback chain's summary error", () => {
    const wrapped = new Error("All endpoints failed for build-review. Attempts: [...]", { cause: refusal });
    expect(semanticReviewBudgetRefusal(wrapped)).toEqual({
      agentId: "change-reviewer", actualTokens: 214_206, limitTokens: 200_000, resetAt: "2026-11-05T00:00:00.000Z",
    });
    expect(semanticReviewBudgetRefusal(refusal)).not.toBeNull();
  });

  it("does not mistake a provider's own billing error for the reviewer's budget", () => {
    expect(semanticReviewBudgetRefusal(new Error("Billing error on openai: 402"))).toBeNull();
    expect(semanticReviewBudgetRefusal(undefined)).toBeNull();
  });

  it("names the reset time and the exact next step, and says nothing was dispatched", () => {
    const action = semanticReviewBudgetRefusalAction(semanticReviewBudgetRefusal(refusal)!);
    expect(action).toContain("2026-11-05T00:00:00.000Z");
    expect(action).toContain("nothing was dispatched");
    expect(action).toContain("retry_semantic_review");
    expect(semanticReviewReasonLabel("reviewer-budget-exhausted")).toMatch(/daily token budget/);
  });

  it("is not reported as an uncertain provider outcome", () => {
    const observation = semanticReviewRecoveryObservation("input-required", { semanticReview: {
      state: "input-required", reason: "reviewer-budget-exhausted", deadlineAt: "2026-11-04T08:39:00.000Z",
      recoveryAttempt: 0, budgetRefusal: { agentId: "change-reviewer", resetAt: "2026-11-05T00:00:00.000Z" } } },
    Date.parse("2026-11-04T08:20:00.000Z"));
    expect(observation.classification).not.toBe("execution-uncertain");
    expect(observation.nextAction).toContain("2026-11-05T00:00:00.000Z");
  });
});
