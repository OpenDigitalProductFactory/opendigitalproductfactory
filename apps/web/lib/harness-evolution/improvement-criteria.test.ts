import { describe, expect, it } from "vitest";

import { DEFAULT_IMPROVEMENT_CRITERIA, expectedSavings, probeK, screenCandidate } from "./improvement-criteria";

// BI-CE564FBB operating criteria, consumed by slice 2 (BI-B8DAEB71): a miss is
// probed only when it is worth it — diminishing returns are the paper's finding.

const base = {
  distinctRuns: 3,
  shapeRunsPerWeek: 10,
  costPerOccurrence: 4,
  occurrencesPerWeek: 5,
  probeCost: 4,
  consecutiveKeepBase: 0,
  insideControlLimits: null as boolean | null,
};

describe("screenCandidate", () => {
  it("passes a recurring, repeated, costly miss whose probe costs less than it saves", () => {
    expect(screenCandidate(base)).toEqual({ eligible: true, k: 1 });
  });

  it("names the first reason a miss is skipped", () => {
    expect(screenCandidate({ ...base, distinctRuns: 1 })).toEqual({ eligible: false, reason: "single-run" });
    expect(screenCandidate({ ...base, shapeRunsPerWeek: 1 })).toEqual({ eligible: false, reason: "shape-too-rare" });
    expect(screenCandidate({ ...base, costPerOccurrence: 0.5 })).toEqual({ eligible: false, reason: "below-floor" });
    expect(screenCandidate({ ...base, consecutiveKeepBase: 2 })).toEqual({ eligible: false, reason: "parked-after-keep-base" });
    expect(screenCandidate({ ...base, insideControlLimits: true })).toEqual({ eligible: false, reason: "inside-control-limits" });
    expect(screenCandidate({ ...base, occurrencesPerWeek: 0.1, costPerOccurrence: 1, probeCost: 4 })).toEqual({
      eligible: false,
      reason: "spend-exceeds-savings",
    });
  });

  it("does not skip a room whose control limits have not been evaluated", () => {
    expect(screenCandidate({ ...base, insideControlLimits: null }).eligible).toBe(true);
  });
});

describe("expectedSavings", () => {
  it("is frequency × cost × horizon", () => {
    expect(expectedSavings({ occurrencesPerWeek: 5, costPerOccurrence: 4 }, DEFAULT_IMPROVEMENT_CRITERIA)).toBe(5 * 4 * 4);
  });
});

describe("probeK", () => {
  it("starts at one and escalates only after KEEP_BASE on a top-decile-cost miss", () => {
    expect(probeK({ consecutiveKeepBase: 0, costPercentile: 0.99 })).toBe(1);
    expect(probeK({ consecutiveKeepBase: 1, costPercentile: 0.5 })).toBe(1);
    expect(probeK({ consecutiveKeepBase: 1, costPercentile: 0.95 })).toBe(2);
  });
});
