import { describe, it, expect } from "vitest";
import {
  deriveMeasuredToolCeiling,
  readToolFidelitySamples,
  mergeToolFidelitySample,
  TOOL_FIDELITY_SCORE_KEY,
  type ToolFidelitySample,
} from "./tool-fidelity-policy";

describe("deriveMeasuredToolCeiling", () => {
  it("returns null with no samples (stays Phase-1 fail-safe)", () => {
    expect(deriveMeasuredToolCeiling(null)).toBeNull();
    expect(deriveMeasuredToolCeiling([])).toBeNull();
  });

  it("returns the largest surface size meeting the accuracy threshold", () => {
    const samples: ToolFidelitySample[] = [
      { surfaceSize: 15, accuracy: 0.97, sampleCount: 20 },
      { surfaceSize: 24, accuracy: 0.93, sampleCount: 20 },
      { surfaceSize: 32, accuracy: 0.71, sampleCount: 20 }, // below threshold
    ];
    expect(deriveMeasuredToolCeiling(samples)).toBe(24);
  });

  it("ignores samples below the minimum sample count (one lucky turn is not evidence)", () => {
    const samples: ToolFidelitySample[] = [
      { surfaceSize: 15, accuracy: 0.95, sampleCount: 10 },
      { surfaceSize: 48, accuracy: 1.0, sampleCount: 2 }, // too few turns
    ];
    expect(deriveMeasuredToolCeiling(samples)).toBe(15);
  });

  it("returns null when every measured surface is below threshold", () => {
    const samples: ToolFidelitySample[] = [
      { surfaceSize: 15, accuracy: 0.6, sampleCount: 20 },
      { surfaceSize: 24, accuracy: 0.4, sampleCount: 20 },
    ];
    expect(deriveMeasuredToolCeiling(samples)).toBeNull();
  });

  it("takes the max qualifying size even when accuracy is non-monotonic", () => {
    const samples: ToolFidelitySample[] = [
      { surfaceSize: 16, accuracy: 0.85, sampleCount: 20 }, // dip, below threshold
      { surfaceSize: 24, accuracy: 0.92, sampleCount: 20 }, // recovers
    ];
    expect(deriveMeasuredToolCeiling(samples)).toBe(24);
  });

  it("honors a custom threshold", () => {
    const samples: ToolFidelitySample[] = [{ surfaceSize: 32, accuracy: 0.82, sampleCount: 20 }];
    expect(deriveMeasuredToolCeiling(samples, { threshold: 0.8 })).toBe(32);
    expect(deriveMeasuredToolCeiling(samples, { threshold: 0.9 })).toBeNull();
  });
});

describe("readToolFidelitySamples", () => {
  it("parses samples from a ModelProfile.customScores blob", () => {
    const customScores = {
      [TOOL_FIDELITY_SCORE_KEY]: [{ surfaceSize: 24, accuracy: 0.93, sampleCount: 20 }],
    };
    expect(readToolFidelitySamples(customScores)).toEqual([
      { surfaceSize: 24, accuracy: 0.93, sampleCount: 20 },
    ]);
  });

  it("is tolerant of missing/malformed data (never throws on the hot path)", () => {
    expect(readToolFidelitySamples(null)).toEqual([]);
    expect(readToolFidelitySamples({})).toEqual([]);
    expect(readToolFidelitySamples({ [TOOL_FIDELITY_SCORE_KEY]: "nope" })).toEqual([]);
    expect(readToolFidelitySamples({ [TOOL_FIDELITY_SCORE_KEY]: [{ bad: 1 }, { surfaceSize: 15, accuracy: 0.9 }] }))
      .toEqual([{ surfaceSize: 15, accuracy: 0.9, sampleCount: 0 }]);
  });
});

describe("mergeToolFidelitySample", () => {
  it("adds a new surface-size sample, sorted", () => {
    const out = mergeToolFidelitySample([{ surfaceSize: 24, accuracy: 0.9, sampleCount: 10 }], 15, 0.95, 10);
    expect(out.map((s) => s.surfaceSize)).toEqual([15, 24]);
  });

  it("count-weights a repeated measurement into a running mean", () => {
    const prior = [{ surfaceSize: 15, accuracy: 0.8, sampleCount: 10 }];
    const out = mergeToolFidelitySample(prior, 15, 1.0, 10);
    const s = out.find((x) => x.surfaceSize === 15)!;
    expect(s.sampleCount).toBe(20);
    expect(s.accuracy).toBeCloseTo(0.9, 5); // (0.8*10 + 1.0*10)/20
  });
});
