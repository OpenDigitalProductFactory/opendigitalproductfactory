import { describe, expect, it } from "vitest";

import { parseWorkPatternOutcomeEvidence } from "./work-pattern-outcome-evidence";

function outcome(overrides: Record<string, unknown> = {}) {
  return {
    completed: true,
    buildGate: {
      unitTests: "pass",
      productionBuild: "pass",
      uxVerification: "not-applicable",
      migration: "not-applicable",
    },
    review: {
      decision: "pass",
      reproducedBlockingFindings: 0,
      nonBlockingFindings: 2,
      reviewRounds: 1,
    },
    execution: {
      toolCalls: 12,
      toolFailures: 1,
      retryCount: 1,
      recoveryActions: ["provider-fallback"],
      manualTouches: 0,
      inputTokens: 4000,
      outputTokens: 1200,
      durationMs: 32000,
      costUsd: 0.18,
    },
    delivery: {
      prCreated: true,
      mergeQueued: true,
      merged: true,
      deployed: true,
      rolledBack: false,
    },
    ...overrides,
  };
}

describe("parseWorkPatternOutcomeEvidence", () => {
  it("preserves build, review, execution, and delivery dimensions", () => {
    expect(parseWorkPatternOutcomeEvidence(outcome())).toEqual(outcome());
  });

  it.each([
    { buildGate: { unitTests: "green", productionBuild: "pass", uxVerification: "not-applicable", migration: "not-applicable" } },
    { review: { decision: "pass", reproducedBlockingFindings: -1, nonBlockingFindings: 0, reviewRounds: 1 } },
    { execution: { toolCalls: 1, toolFailures: 0, retryCount: 0, recoveryActions: [], manualTouches: 0, durationMs: -1 } },
    { delivery: { prCreated: true, mergeQueued: true, merged: true, deployed: "yes", rolledBack: false } },
  ])("fails closed for malformed evidence", (override) => {
    expect(parseWorkPatternOutcomeEvidence(outcome(override))).toBeNull();
  });

  it("retains an explicit failure class without inventing a reward score", () => {
    const parsed = parseWorkPatternOutcomeEvidence(outcome({
      completed: false,
      failureClass: "production-build",
    }));

    expect(parsed?.failureClass).toBe("production-build");
    expect(parsed).not.toHaveProperty("reward");
    expect(parsed).not.toHaveProperty("score");
  });
});
