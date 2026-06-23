import { describe, expect, it } from "vitest";

import { compileGoldenTrianglePolicy } from "@/lib/golden-triangle";

import {
  PRESET_WEIGHTS,
  decodePostureForDisplay,
  describeConfigured,
  plainSummary,
  pointToWeights,
  preferenceFromPreset,
  weightsToPoint,
} from "./posture-display";

describe("posture-display geometry", () => {
  it("weights -> point -> weights round-trips for every preset", () => {
    for (const preset of ["fast", "balanced", "assured", "frugal"] as const) {
      const [q, c, t] = PRESET_WEIGHTS[preset];
      const p = weightsToPoint(q, c, t);
      const back = pointToWeights(p.x, p.y);
      expect(back.qualityWeight).toBeCloseTo(q, 5);
      expect(back.costWeight).toBeCloseTo(c, 5);
      expect(back.timeWeight).toBeCloseTo(t, 5);
    }
  });

  it("the quality vertex maps to the apex (0.5, 0)", () => {
    const p = weightsToPoint(1, 0, 0);
    expect(p.x).toBeCloseTo(0.5, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it("normalizes unnormalized weights", () => {
    const a = weightsToPoint(2, 1, 1);
    const b = weightsToPoint(0.5, 0.25, 0.25);
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
  });
});

describe("describeConfigured (driven by the real compiler)", () => {
  it("Assured surfaces frontier tier + deep verification", () => {
    const decoded = compileGoldenTrianglePolicy({
      preference: preferenceFromPreset("assured"),
      taskClass: "code-gen",
      authorityScope: { kind: "wwmd" },
    });
    const labels = describeConfigured(decoded).map((c) => c.label);
    expect(labels).toContain("Frontier tier");
    expect(labels.some((l) => /Deep verification/.test(l))).toBe(true);
  });

  it("Balanced shows the platform-defaults chip (no deltas)", () => {
    const decoded = compileGoldenTrianglePolicy({
      preference: preferenceFromPreset("balanced"),
      taskClass: "conversation",
      authorityScope: { kind: "wwmd" },
    });
    expect(describeConfigured(decoded)).toEqual([{ icon: "adjustments-horizontal", label: "Platform defaults" }]);
  });
});

describe("plainSummary", () => {
  it("uses the preset line for named presets", () => {
    expect(plainSummary(preferenceFromPreset("fast"))).toMatch(/Quickest/);
    expect(plainSummary(preferenceFromPreset("frugal"))).toMatch(/least/i);
  });

  it("describes a moderate custom lean", () => {
    expect(plainSummary({ preset: "custom", qualityWeight: 0.45, costWeight: 0.3, timeWeight: 0.25 })).toMatch(/right/i);
  });

  it("falls back to balanced for an unfocused custom posture", () => {
    expect(plainSummary({ preset: "custom", qualityWeight: 0.34, costWeight: 0.33, timeWeight: 0.33 })).toMatch(/balance/i);
  });
});

describe("decodePostureForDisplay", () => {
  it("returns decoded policy + plain + chips together", () => {
    const view = decodePostureForDisplay(preferenceFromPreset("frugal"));
    expect(view.decoded.postureOverride.budgetClass).toBe("minimize_cost");
    expect(view.plain).toMatch(/least/i);
    expect(view.chips.length).toBeGreaterThan(0);
  });
});
