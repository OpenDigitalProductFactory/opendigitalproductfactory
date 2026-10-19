import { describe, expect, it, vi } from "vitest";
import { decisionInteractionRowToEvaluation, persistDecisionInteraction } from "./persistence";
import { decisionAllowsStep, withDecisionEscalation } from "./decision-escalation";
import type { DecisionPerspectiveEvaluationResult } from "./types";

function evaluation(): DecisionPerspectiveEvaluationResult {
  return {
    outcomeType: "escalate", selectedProfileId: "profile-test", fallbackProfileId: null,
    profileVersionId: "version-test", confidenceBefore: 0.2, confidenceAfter: 0.2,
    confidenceScore: 0.2, coverageGap: false, principleConflict: false,
    domainClass: "plan-readiness", resolvedProfileChain: ["profile-test"], materialCount: 0,
    freshnessDistribution: { current: 0, stale: 0, superseded: 0, contradicted: 0 },
    riskTier: "medium", question: "Should this bounded step proceed?", options: ["proceed", "hold"],
    rationale: "Insufficient corpus", materialScores: [], sources: [],
    gapReason: "material-below-confidence",
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return { interactionId: "decision-test", profileId: "profile-test", profileVersionId: "version-test",
    riskTier: "medium", outcomeType: "escalate", outcomePayload: {}, ...overrides };
}

describe("recorded escalation persistence and replay", () => {
  it("writes the enum route, reason and follow-on on the existing interaction", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => data);
    const routed = withDecisionEscalation(evaluation());
    await persistDecisionInteraction({ db: { decisionInteraction: { create } }, evaluation: routed });
    expect(create.mock.calls[0]?.[0].data).toMatchObject({
      escalationRoute: "independent_review", escalationReason: "independent-review-required",
      escalationFollowOn: "corpus-gap",
    });
  });

  it("round trips a recorded route rather than recomputing from missing historical evidence", () => {
    const restored = decisionInteractionRowToEvaluation(row({
      escalationRoute: "independent_review", escalationReason: "independent-review-required",
      escalationFollowOn: "policy-limit",
    }));
    expect(restored.escalation).toEqual({ route: "independent-review", reasonCode: "independent-review-required",
      followOn: "policy-limit", damaging: false });
    expect(decisionAllowsStep(restored)).toBe(true);
  });

  it("restores damaging human route even when the historical outcome was decisive", () => {
    const restored = decisionInteractionRowToEvaluation(row({ outcomeType: "recommend",
      escalationRoute: "human", escalationReason: "damaging-threshold", escalationFollowOn: null }));
    expect(restored.escalation?.reasonCode).toBe("damaging-threshold");
    expect(decisionAllowsStep(restored)).toBe(false);
  });

  it("leaves legacy NULL routes absent and unresolved legacy replay held", () => {
    const restored = decisionInteractionRowToEvaluation(row({ escalationRoute: null,
      outcomePayload: { evaluationFault: true, coverageGap: true } }));
    expect(restored.escalation).toBeUndefined();
    expect(decisionAllowsStep(restored)).toBe(false);
  });

  it("preserves a decisive decline through write and replay despite conflicting extra metadata", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => data);
    const routed = withDecisionEscalation({ ...evaluation(), outcomeType: "recommend", stanceAlignment: "decline", novelProposition: true } as const);
    const persisted = await persistDecisionInteraction({ db: { decisionInteraction: { create } }, evaluation: routed,
      outcomePayloadExtra: { stanceAlignment: "approve", novelProposition: false } });
    const restored = decisionInteractionRowToEvaluation(row(persisted.row));
    expect(restored.stanceAlignment).toBe("decline");
    expect(restored.novelProposition).toBe(true);
    expect(decisionAllowsStep(restored)).toBe(false);
  });

  it.each([
    { escalationRoute: "unknown-route", escalationReason: "decided" },
    { escalationRoute: "independent_review", escalationReason: "independent-review-required", escalationFollowOn: null },
    { escalationRoute: "human", escalationReason: null },
    { escalationRoute: "decided", escalationReason: "damaging-consequence" },
    { riskTier: "critical", escalationRoute: "independent_review", escalationReason: "independent-review-required", escalationFollowOn: "corpus-gap" },
    { riskTier: "unknown", escalationRoute: "decided", escalationReason: "decided" },
  ])("rejects malformed non-legacy route evidence without manufacturing permission (%j)", (invalid) => {
    expect(() => decisionInteractionRowToEvaluation(row(invalid))).toThrow(/escalation/i);
  });
});
