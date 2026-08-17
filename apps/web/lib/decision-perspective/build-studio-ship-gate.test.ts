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

describe("ship gate acumen consults (W16, BI-18519A73)", () => {
  it("stays byte-identical when plannedFilePaths is absent", async () => {
    evaluateGate.mockResolvedValue({
      allowed: true,
      interactionId: "DI-ship-2",
      evaluation: { outcomeType: "recommend" },
      operatorMessage: "Recommended",
      orgProfileSelected: false,
    });
    const runner = vi.fn();

    const result = await evaluateBuildStudioShipGate({
      db: {},
      build: { buildId: "FB-TEST", planReview: null, deliberationSummary: null },
      sensitivity: "low",
      acumenConsultRunner: runner as never,
    });

    expect(runner).not.toHaveBeenCalled();
    expect((result as { acumenConsults?: unknown }).acumenConsults).toBeUndefined();
    expect(result.operatorMessage).toBe("Recommended");
  });

  it("attaches advisory consults without changing the ship verdict", async () => {
    evaluateGate.mockResolvedValue({
      allowed: true,
      interactionId: "DI-ship-3",
      evaluation: { outcomeType: "recommend" },
      operatorMessage: "Recommended",
      orgProfileSelected: false,
    });
    const runner = vi.fn().mockResolvedValue([
      {
        professionKey: "security",
        interactionId: "DI-ACU-SEC",
        outcomeType: "defer",
        confidenceScore: 0,
        rationale: "no applicable craft guidance",
        professionProfileSelected: false,
      },
    ]);

    const result = await evaluateBuildStudioShipGate({
      db: {},
      build: { buildId: "FB-TEST", planReview: null, deliberationSummary: null },
      sensitivity: "low",
      plannedFilePaths: ["apps/web/app/api/users/route.ts"],
      acumenConsultRunner: runner as never,
    });

    expect(result.allowed).toBe(true);
    expect((result as { acumenConsults?: unknown[] }).acumenConsults?.length).toBe(1);
    expect(result.operatorMessage).toContain("security: defer");
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        filePaths: ["apps/web/app/api/users/route.ts"],
        phaseFrom: "review",
        phaseTo: "ship",
        callingPopulation: "build_studio_phase_gate",
      }),
    );
  });
});
