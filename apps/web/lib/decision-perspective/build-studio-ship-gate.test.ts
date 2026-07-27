import { describe, expect, it, vi } from "vitest";

const evaluateGate = vi.hoisted(() => vi.fn());
vi.mock("./evaluator", () => ({
  evaluatePerspectiveGate: evaluateGate,
}));

import {
  evaluateBuildStudioIdeateStartGate,
  evaluateBuildStudioShipGate,
} from "./build-studio-ship-gate";

describe("evaluateBuildStudioShipGate", () => {
  it("uses the graduated critical tier for high-sensitivity ship", async () => {
    evaluateGate.mockResolvedValue({
      allowed: false,
      interactionId: "DI-ship",
      evaluation: { outcomeType: "escalate" },
      operatorMessage: "Needs your decision",
      orgProfileSelected: false,
    });

    await evaluateBuildStudioShipGate({
      db: {},
      build: {
        buildId: "FB-TEST",
        planReview: null,
        deliberationSummary: null,
      },
      sensitivity: "high",
      triggeredByUserId: "user-1",
    });

    expect(evaluateGate).toHaveBeenCalledWith(expect.objectContaining({
      riskTier: "critical",
      phaseFrom: "review",
      phaseTo: "ship",
      domainClass: "risk-assessment",
    }));
  });
});

describe("evaluateBuildStudioIdeateStartGate", () => {
  it("keeps low-sensitivity ideate start at the low graduated tier", async () => {
    evaluateGate.mockResolvedValue({
      allowed: true,
      interactionId: "DI-ideate",
      evaluation: { outcomeType: "recommend" },
      operatorMessage: "Recommended",
      orgProfileSelected: false,
    });

    await evaluateBuildStudioIdeateStartGate({
      db: {},
      build: {
        buildId: "FB-TEST",
        planReview: null,
        deliberationSummary: null,
      },
      sensitivity: "low",
    });

    expect(evaluateGate).toHaveBeenLastCalledWith(expect.objectContaining({
      riskTier: "low",
      phaseFrom: "intake",
      phaseTo: "ideate",
    }));
  });
});
