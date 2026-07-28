import { describe, expect, it } from "vitest";

import { computeDemandActivationTelemetry } from "./activation-telemetry";

describe("computeDemandActivationTelemetry", () => {
  it("measures completeness rather than clicks", () => {
    expect(
      computeDemandActivationTelemetry([
        {
          demandStage: null,
          evidenceCount: 0,
          demandScore: null,
          scoreExplanationComplete: false,
          fundingDecisionCount: 0,
        },
        {
          demandStage: "shaped",
          evidenceCount: 2,
          demandScore: 12,
          scoreExplanationComplete: true,
          fundingDecisionCount: 0,
        },
        {
          demandStage: "ready",
          evidenceCount: 1,
          demandScore: 9,
          scoreExplanationComplete: true,
          fundingDecisionCount: 1,
        },
      ]),
    ).toEqual({
      total: 3,
      classified: 2,
      evidenceLinked: 2,
      explainablyScored: 2,
      fundingDecided: 1,
      classifiedPct: 66.7,
      evidenceLinkedPct: 66.7,
      explainablyScoredPct: 66.7,
      fundingDecidedPct: 33.3,
    });
  });

  it("returns honest zero coverage for an empty population", () => {
    expect(computeDemandActivationTelemetry([])).toEqual({
      total: 0,
      classified: 0,
      evidenceLinked: 0,
      explainablyScored: 0,
      fundingDecided: 0,
      classifiedPct: 0,
      evidenceLinkedPct: 0,
      explainablyScoredPct: 0,
      fundingDecidedPct: 0,
    });
  });
});
