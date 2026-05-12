import { describe, expect, it } from "vitest";

import {
  mapCapacityCandidateToAutonomousWorkRunInput,
  type CapacityContinuityCandidate,
} from "./candidates";

const baseCandidate: CapacityContinuityCandidate = {
  candidateId: "cap-cand-1",
  dedupeKey: "standing-order:weekly-backlog-hygiene:2026-05-12",
  source: "standing-order",
  title: "Weekly backlog hygiene",
  objective: "Review open backlog items and produce evidence-backed cleanup recommendations.",
  routeContext: "/platform/backlog",
  agentId: "agent-capacity",
  ownerPrincipalId: "user-owner",
  riskClass: "read-only",
  evidenceRequired: ["Backlog items reviewed", "Recommended status changes captured"],
  capacityFit: {
    providerClassHint: "fixed-cost",
    modelTierHint: "standard",
    reason: "Uses already-paid capacity for low-risk review work.",
  },
  sourceRef: {
    kind: "standing-order",
    id: "standing-order-weekly-backlog-hygiene",
  },
  capacityState: "surplus",
  capacityWindowId: "window-2026-05-12-am",
};

describe("mapCapacityCandidateToAutonomousWorkRunInput", () => {
  it("maps an accepted capacity candidate to the autonomous work run seam", () => {
    const result = mapCapacityCandidateToAutonomousWorkRunInput(baseCandidate, {
      resolvedTools: [{ name: "list_backlog_items" }],
      toolGrantMapping: { list_backlog_items: ["backlog_read"] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.rejection.reason);
    }

    expect(result.input).toMatchObject({
      trigger: "capacity-continuity",
      userId: "user-owner",
      agentId: "agent-capacity",
      routeContext: "/platform/backlog",
      title: "Weekly backlog hygiene",
      objective:
        "Review open backlog items and produce evidence-backed cleanup recommendations.",
      prompt:
        "Review open backlog items and produce evidence-backed cleanup recommendations.",
      sourceRef: {
        kind: "standing-order",
        id: "standing-order-weekly-backlog-hygiene",
      },
    });
    expect(result.input.metadata).toEqual({
      cognitiveLoad: {
        capacityState: "surplus",
        capacityWindowId: "window-2026-05-12-am",
        dedupeKey: "standing-order:weekly-backlog-hygiene:2026-05-12",
        evidenceRequired: [
          "Backlog items reviewed",
          "Recommended status changes captured",
        ],
        fundingFitHint: {
          providerClassHint: "fixed-cost",
          modelTierHint: "standard",
          reason: "Uses already-paid capacity for low-risk review work.",
        },
        riskClass: "read-only",
      },
    });
  });

  it("rejects candidates that require forbidden tool grants before creating a run", () => {
    const result = mapCapacityCandidateToAutonomousWorkRunInput(baseCandidate, {
      resolvedTools: [{ name: "deploy_release" }],
      toolGrantMapping: { deploy_release: ["release_gate_create"] },
    });

    expect(result).toEqual({
      ok: false,
      rejection: {
        code: "forbidden_grant",
        reason:
          "Capacity continuity cannot start work that requires the release_gate_create grant.",
        details: {
          grant: "release_gate_create",
          toolName: "deploy_release",
        },
      },
    });
  });

  it("rejects vague work that has no resolvable artifact target", () => {
    const result = mapCapacityCandidateToAutonomousWorkRunInput({
      ...baseCandidate,
      objective: "Think about strategy.",
      evidenceRequired: [],
      sourceRef: {
        kind: "standing-order",
        id: "standing-order-strategy",
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected vague work to be rejected.");
    }
    expect(result.rejection.code).toBe("ambiguous_objective");
  });

  it("keeps standing-order attribution in sourceRef when the standing order is the source", () => {
    const result = mapCapacityCandidateToAutonomousWorkRunInput(baseCandidate);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.rejection.reason);
    }
    expect(result.input.sourceRef).toEqual({
      kind: "standing-order",
      id: "standing-order-weekly-backlog-hygiene",
    });
    expect(result.input.metadata).not.toMatchObject({
      cognitiveLoad: {
        viaStandingOrderId: expect.any(String),
      },
    });
  });

  it("records viaStandingOrderId only when another artifact is the sourceRef", () => {
    const result = mapCapacityCandidateToAutonomousWorkRunInput({
      ...baseCandidate,
      source: "backlog",
      sourceRef: {
        kind: "backlog-item",
        id: "BI-123",
      },
      viaStandingOrderId: "standing-order-weekly-backlog-hygiene",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.rejection.reason);
    }
    expect(result.input.sourceRef).toEqual({
      kind: "backlog-item",
      id: "BI-123",
    });
    expect(result.input.metadata).toMatchObject({
      cognitiveLoad: {
        viaStandingOrderId: "standing-order-weekly-backlog-hygiene",
      },
    });
  });

  it("carries finance and routing hints in metadata without provider pinning", () => {
    const result = mapCapacityCandidateToAutonomousWorkRunInput({
      ...baseCandidate,
      routingHints: {
        budgetClass: "minimize_cost",
        interactionMode: "background",
        modelTierHint: "standard",
        preferredProviderClass: "fixed-cost",
        reasonCodes: ["underused_commitment", "safe_background_work"],
      },
      financeTracking: {
        candidateId: "cap-cand-1",
        dedupeKey: "standing-order:weekly-backlog-hygiene:2026-05-12",
        observedProviderClasses: ["fixed-cost"],
        sourceProviderIds: ["openai-subscription"],
        projectedUnusedValue: 120,
        utilizationPct: 35,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.rejection.reason);
    }
    expect(result.input.metadata).toMatchObject({
      cognitiveLoad: {
        routingHints: {
          budgetClass: "minimize_cost",
          interactionMode: "background",
          modelTierHint: "standard",
          preferredProviderClass: "fixed-cost",
          reasonCodes: ["underused_commitment", "safe_background_work"],
        },
        financeTracking: {
          observedProviderClasses: ["fixed-cost"],
          sourceProviderIds: ["openai-subscription"],
          projectedUnusedValue: 120,
          utilizationPct: 35,
        },
      },
    });
    expect(JSON.stringify(result.input.metadata)).not.toContain("allowedProviders");
    expect(JSON.stringify(result.input.metadata)).not.toContain("preferredProviderId");
  });
});
