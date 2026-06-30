import { describe, expect, it } from "vitest";

import {
  analyzeCoworkerEngagementRefinement,
  classifyCoworkerEngagementProcessStage,
} from "./process-refinement";

const baseEngagement = {
  engagementId: "CE-1",
  offerId: "offer-payment",
  serviceId: "svc-payment",
  providerAgentId: "payment-compliance-coworker",
  requestedOutcome: "Review PCI impact for checkout.",
  status: "completed",
  metadata: {},
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-01T01:00:00.000Z"),
  completedAt: new Date("2026-06-01T02:00:00.000Z"),
};

describe("coworker engagement process refinement", () => {
  it("classifies engagement stages from metadata and history", () => {
    expect(classifyCoworkerEngagementProcessStage({ ...baseEngagement, metadata: {} })).toBe("emergent");
    expect(
      classifyCoworkerEngagementProcessStage({
        ...baseEngagement,
        metadata: { processRefinement: { stage: "codified", aggregateOfferKey: "aggregate-payment-compliance-requirements" } },
      }),
    ).toBe("codified");
    expect(
      classifyCoworkerEngagementProcessStage(
        { ...baseEngagement, metadata: {} },
        { repeatedPatternCount: 3, codifiedThreshold: 5 },
      ),
    ).toBe("repeatable");
  });

  it("promotes repeated completed patterns into aggregate offer candidates with DMAIC metrics", () => {
    const result = analyzeCoworkerEngagementRefinement([
      { ...baseEngagement, engagementId: "CE-1", requestedOutcome: "Review PCI impact for checkout." },
      { ...baseEngagement, engagementId: "CE-2", requestedOutcome: "Review PCI impact for checkout." },
      {
        ...baseEngagement,
        engagementId: "CE-3",
        requestedOutcome: "Review PCI impact for checkout.",
        status: "needs-approval",
        completedAt: null,
      },
      {
        ...baseEngagement,
        engagementId: "CE-4",
        offerId: "offer-legal",
        serviceId: "svc-legal",
        providerAgentId: "legal-coworker",
        requestedOutcome: "Draft unusual one-off clause.",
        status: "requested",
        completedAt: null,
      },
    ]);

    expect(result.summary).toMatchObject({
      totalEngagements: 4,
      emergent: 1,
      repeatable: 3,
      codified: 0,
      approvalRequired: 1,
      completed: 2,
    });
    expect(result.aggregateOfferCandidates).toEqual([
      expect.objectContaining({
        offerId: "offer-payment",
        serviceId: "svc-payment",
        providerAgentId: "payment-compliance-coworker",
        patternKey: "offer-payment::review pci impact for checkout",
        engagementCount: 3,
        recommendedStage: "repeatable",
        dmaic: expect.objectContaining({
          define: "Review PCI impact for checkout.",
          measure: expect.objectContaining({ total: 3, completed: 2, approvalRequired: 1 }),
          analyze: expect.objectContaining({ bottlenecks: ["approval-required"] }),
          improve: expect.arrayContaining(["Promote this repeated request into an aggregate offer or playbook."]),
          control: expect.arrayContaining(["Track cycle time, approval rate, completion rate, and rework for this pattern."]),
        }),
      }),
    ]);
  });
});
