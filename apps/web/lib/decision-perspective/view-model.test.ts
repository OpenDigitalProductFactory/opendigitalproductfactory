import { describe, expect, it } from "vitest";

import { decisionInteractionRowToGateView } from "./view-model";

describe("decisionInteractionRowToGateView", () => {
  it("normalizes a decision interaction row for Build Studio display", () => {
    const view = decisionInteractionRowToGateView({
      interactionId: "DI-ABC123",
      profileId: "mark-dpf-platform",
      profileVersionId: "DPV-1",
      domainClass: "plan-readiness",
      outcomeType: "escalate",
      confidenceBefore: 0.72,
      confidenceAfter: 0.6,
      principleConflict: true,
      rationale: "Recent overrides lowered confidence below the autonomy threshold.",
      sources: [
        {
          materialId: "DPM-1",
          sourceType: "principle",
          summary: "Confidence must be earned in drops and lost in buckets.",
          effectiveWeight: 0.9,
        },
      ],
      outcomePayload: {
        confidenceScore: 0.6,
        materialCount: 2,
        freshnessDistribution: { current: 2, stale: 0, superseded: 0, contradicted: 0 },
      },
      evidenceBundle: {},
      createdAt: new Date("2026-05-17T20:00:00.000Z"),
      escalationCapture: null,
      deferralCapture: null,
    });

    expect(view).toEqual({
      interactionId: "DI-ABC123",
      profileId: "mark-dpf-platform",
      profileVersionId: "DPV-1",
      domainClass: "plan-readiness",
      outcomeType: "escalate",
      confidenceBefore: 0.72,
      confidenceAfter: 0.6,
      confidenceScore: 0.6,
      materialCount: 2,
      principleConflict: true,
      rationale: "Recent overrides lowered confidence below the autonomy threshold.",
      createdAt: new Date("2026-05-17T20:00:00.000Z"),
      sources: [
        {
          materialId: "DPM-1",
          sourceType: "principle",
          summary: "Confidence must be earned in drops and lost in buckets.",
          effectiveWeight: 0.9,
        },
      ],
      scoredOptions: null,
      recommendedOptionId: null,
      chosenOptionId: null,
      escalationCaptured: false,
      deferralCaptured: false,
    });
  });

  it("round-trips scored options / recommendedOptionId / chosenOptionId, dropping malformed entries (BI-6DCF772F)", () => {
    const view = decisionInteractionRowToGateView({
      interactionId: "DI-SCORED",
      profileId: "p",
      profileVersionId: "v",
      domainClass: "risk-assessment",
      outcomeType: "escalate",
      confidenceBefore: null,
      confidenceAfter: null,
      principleConflict: false,
      rationale: null,
      sources: [],
      outcomePayload: {},
      evidenceBundle: {},
      createdAt: new Date("2026-07-24T00:00:00.000Z"),
      scoredOptions: [
        { id: "a", description: "Option A", features: { speed_to_value: 0.8 } },
        { description: "no id — dropped" },
      ],
      recommendedOptionId: "a",
      chosenOptionId: "a",
      escalationCapture: null,
      deferralCapture: null,
    });

    expect(view.scoredOptions).toEqual([
      { id: "a", description: "Option A", features: { speed_to_value: 0.8 } },
    ]);
    expect(view.recommendedOptionId).toBe("a");
    expect(view.chosenOptionId).toBe("a");
  });

  it("normalizes absent/empty scored options to null (no picker)", () => {
    const base = {
      interactionId: "DI-X",
      profileId: "p",
      profileVersionId: "v",
      domainClass: "plan-readiness",
      outcomeType: "escalate",
      confidenceBefore: null,
      confidenceAfter: null,
      principleConflict: false,
      rationale: null,
      sources: [],
      outcomePayload: {},
      evidenceBundle: {},
      createdAt: new Date("2026-07-24T00:00:00.000Z"),
      escalationCapture: null,
      deferralCapture: null,
    };
    expect(decisionInteractionRowToGateView(base).scoredOptions).toBeNull();
    expect(decisionInteractionRowToGateView({ ...base, scoredOptions: [] }).scoredOptions).toBeNull();
  });

  it("falls back to safe display defaults for sparse rows", () => {
    const view = decisionInteractionRowToGateView({
      interactionId: "DI-SPARSE",
      profileId: "profile-1",
      profileVersionId: "version-1",
      domainClass: null,
      outcomeType: "unknown",
      confidenceBefore: null,
      confidenceAfter: null,
      principleConflict: false,
      rationale: null,
      sources: null,
      outcomePayload: {},
      evidenceBundle: {},
      createdAt: new Date("2026-05-17T20:00:00.000Z"),
      escalationCapture: { id: "esc-1" },
      deferralCapture: null,
    });

    expect(view.outcomeType).toBe("escalate");
    expect(view.domainClass).toBe("plan-readiness");
    expect(view.confidenceScore).toBe(0);
    expect(view.materialCount).toBe(0);
    expect(view.sources).toEqual([]);
    expect(view.escalationCaptured).toBe(true);
    expect(view.deferralCaptured).toBe(false);
  });
});
