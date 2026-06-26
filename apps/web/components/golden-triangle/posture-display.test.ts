import { describe, expect, it } from "vitest";

import { compileGoldenTrianglePolicy } from "@/lib/golden-triangle";

import {
  PRESET_WEIGHTS,
  balanceState,
  decodePostureForDisplay,
  describeConfigured,
  plainSummary,
  pointToWeights,
  postureLabel,
  preferenceFromPreset,
  weightsToPoint,
} from "./posture-display";

describe("postureLabel — every position reads meaningfully (never bare 'Custom')", () => {
  it("uses the preset name for a preset", () => {
    expect(postureLabel(preferenceFromPreset("assured"))).toBe("Assured");
    expect(postureLabel(preferenceFromPreset("frugal"))).toBe("Frugal");
  });
  it("labels the maxed corner as 'Max <dimension>'", () => {
    expect(postureLabel({ preset: "custom", qualityWeight: 1, costWeight: 0, timeWeight: 0 })).toBe("Max Quality");
    expect(postureLabel({ preset: "custom", qualityWeight: 0, costWeight: 1, timeWeight: 0 })).toBe("Max Cost");
    expect(postureLabel({ preset: "custom", qualityWeight: 0, costWeight: 0, timeWeight: 1 })).toBe("Max Speed");
  });
  it("labels a strong-but-not-max lean as '<dimension>-first'", () => {
    expect(postureLabel({ preset: "custom", qualityWeight: 0.7, costWeight: 0.2, timeWeight: 0.1 })).toBe("Quality-first");
  });
  it("labels a near-centroid custom posture 'Balanced'", () => {
    expect(postureLabel({ preset: "custom", qualityWeight: 0.34, costWeight: 0.33, timeWeight: 0.33 })).toBe("Balanced");
  });
});

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

  it("maxing Quality describes a debate (the top of the rigor ladder)", () => {
    expect(plainSummary({ preset: "custom", qualityWeight: 0.9, costWeight: 0.05, timeWeight: 0.05 })).toMatch(/debate/i);
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

describe("balanceState (triangle colouring)", () => {
  it("a centred posture is green with nothing starved", () => {
    const b = balanceState(0.34, 0.33, 0.33);
    expect(b.level).toBe("balanced");
    expect(b.token).toBe("--dpf-success");
    expect(b.starved).toEqual([]);
  });

  it("a near-vertex posture is red and starves the two low axes", () => {
    const b = balanceState(0.9, 0.05, 0.05);
    expect(b.level).toBe("starved");
    expect(b.token).toBe("--dpf-error");
    expect(b.starved).toEqual(["Cost", "Time"]);
    expect(b.label).toMatch(/Starving Cost & Time/);
  });

  it("an edge posture starves one axis (red)", () => {
    const b = balanceState(0.5, 0.45, 0.05);
    expect(b.token).toBe("--dpf-error");
    expect(b.starved).toEqual(["Time"]);
  });

  it("a moderate lean is yellow with nothing starved", () => {
    const b = balanceState(0.5, 0.3, 0.2);
    expect(b.level).toBe("leaning");
    expect(b.token).toBe("--dpf-warning");
    expect(b.starved).toEqual([]);
  });
});

import { postureAxisColor, postureBlendColor } from "./posture-display";

describe("postureAxisColor (red→yellow→green ramp)", () => {
  it("is red when an axis is starved (0)", () => {
    const [r, g] = postureAxisColor(0);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(120);
  });
  it("is yellow at a fair/balanced share (~0.42)", () => {
    const [r, g, b] = postureAxisColor(0.42);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeGreaterThan(150);
    expect(b).toBeLessThan(60);
  });
  it("is green when an axis dominates (1)", () => {
    const [r, g] = postureAxisColor(1);
    expect(g).toBeGreaterThan(150);
    expect(r).toBeLessThan(120);
  });
  it("clamps out-of-range weights", () => {
    expect(postureAxisColor(-1)).toEqual(postureAxisColor(0));
    expect(postureAxisColor(2)).toEqual(postureAxisColor(1));
  });
});

describe("postureBlendColor", () => {
  it("reads green-dominant when one axis is maxed (corner)", () => {
    const [r, g] = postureBlendColor(1, 0, 0);
    expect(g).toBeGreaterThan(r);
  });
  it("reads yellow-ish when balanced (centre)", () => {
    const [r, g, b] = postureBlendColor(0.34, 0.33, 0.33);
    expect(r).toBeGreaterThan(150);
    expect(g).toBeGreaterThan(150);
    expect(b).toBeLessThan(100);
  });
});
