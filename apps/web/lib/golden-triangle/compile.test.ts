import { describe, it, expect } from "vitest";
import { compileGoldenTrianglePolicy, GOLDEN_TRIANGLE_COMPILER_VERSION } from "./compile";
import type { CompileInput, GoldenTrianglePreference, GoldenTrianglePreset } from "./types";

function pref(preset: GoldenTrianglePreset, weights?: Partial<GoldenTrianglePreference>): GoldenTrianglePreference {
  const base: Record<Exclude<GoldenTrianglePreset, "custom">, [number, number, number]> = {
    balanced: [1 / 3, 1 / 3, 1 / 3],
    assured: [0.1, 0.8, 0.1],
    fast: [0.1, 0.1, 0.8],
    frugal: [0.8, 0.1, 0.1],
  };
  const [costWeight, qualityWeight, timeWeight] = preset === "custom" ? [1 / 3, 1 / 3, 1 / 3] : base[preset];
  return { preset, costWeight, qualityWeight, timeWeight, ...weights };
}

function input(preference: GoldenTrianglePreference, extra?: Partial<CompileInput>): CompileInput {
  return {
    preference,
    taskClass: "code-gen",
    authorityScope: { kind: "wwmd" },
    ...extra,
  };
}

describe("compileGoldenTrianglePolicy — presets", () => {
  it("Balanced compiles to NO deltas (cold-start pass-through)", () => {
    const out = compileGoldenTrianglePolicy(input(pref("balanced")));
    expect(out.postureOverride).toEqual({});
    expect(out.orchestrationBudget).toEqual({});
    expect(out.adjustments).toEqual([]);
    expect(out.state).toBe("ok");
    expect(out.compilerVersion).toBe(GOLDEN_TRIANGLE_COMPILER_VERSION);
  });

  it("Assured → quality_first, high effort, frontier tier, deep verification", () => {
    const out = compileGoldenTrianglePolicy(input(pref("assured")));
    expect(out.postureOverride).toEqual({
      budgetClass: "quality_first",
      reasoningDepth: "high",
      effort: "high",
      minimumTier: "frontier",
    });
    expect(out.orchestrationBudget).toEqual({
      verificationDepth: "deep",
      retryBudget: 3,
      deliberationPattern: "review",
    });
    expect(out.state).toBe("ok");
  });

  it("Fast → low reasoning/effort, latency target, single pass, no verification", () => {
    const out = compileGoldenTrianglePolicy(input(pref("fast")));
    expect(out.postureOverride).toEqual({ reasoningDepth: "low", effort: "low", maxLatencyMs: 30_000 });
    expect(out.orchestrationBudget).toEqual({ verificationDepth: "none", retryBudget: 1 });
  });

  it("Frugal → minimize_cost, low effort, adequate tier, shallow verification", () => {
    const out = compileGoldenTrianglePolicy(input(pref("frugal")));
    expect(out.postureOverride).toEqual({
      budgetClass: "minimize_cost",
      reasoningDepth: "low",
      effort: "low",
      minimumTier: "adequate",
    });
    expect(out.orchestrationBudget).toEqual({ verificationDepth: "shallow", retryBudget: 1 });
  });
});

describe("compileGoldenTrianglePolicy — verification policy floor", () => {
  it("makes a deep PolicyConstraints floor load-bearing even for Fast", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("fast"), { policyConstraints: { verificationDepthFloor: "deep" } }),
    );
    expect(out.orchestrationBudget.verificationDepth).toBe("deep");
    expect(out.adjustments).toContainEqual(
      expect.objectContaining({
        field: "verificationDepth",
        reasonCode: "verification_depth_floor",
        to: "deep",
      }),
    );
  });

  it("never lets a shallower policy floor reduce an already-deep posture", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("assured"), { policyConstraints: { verificationDepthFloor: "shallow" } }),
    );
    expect(out.orchestrationBudget.verificationDepth).toBe("deep");
    expect(out.adjustments).not.toContainEqual(
      expect.objectContaining({ reasonCode: "verification_depth_floor" }),
    );
  });
});

describe("compileGoldenTrianglePolicy — custom positions", () => {
  it("cost-dominant (0.6/0.3/0.1) → minimize_cost (frugal-leaning)", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("custom", { costWeight: 0.6, qualityWeight: 0.3, timeWeight: 0.1 })),
    );
    expect(out.postureOverride.budgetClass).toBe("minimize_cost");
    expect(out.postureOverride.minimumTier).toBe("adequate");
    expect(out.orchestrationBudget.verificationDepth).toBe("shallow");
  });

  it("quality-dominant (0.2/0.6/0.2) → quality_first, frontier tier", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("custom", { costWeight: 0.2, qualityWeight: 0.6, timeWeight: 0.2 })),
    );
    expect(out.postureOverride.budgetClass).toBe("quality_first");
    expect(out.postureOverride.minimumTier).toBe("frontier");
    expect(out.orchestrationBudget.verificationDepth).toBe("deep");
  });

  it("time-dominant (0.2/0.2/0.6) → fast (latency target set)", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("custom", { costWeight: 0.2, qualityWeight: 0.2, timeWeight: 0.6 })),
    );
    expect(out.postureOverride.maxLatencyMs).toBe(30_000);
    expect(out.orchestrationBudget.verificationDepth).toBe("none");
  });

  it("near-balanced custom (0.34/0.33/0.33) → no deltas", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("custom", { costWeight: 0.34, qualityWeight: 0.33, timeWeight: 0.33 })),
    );
    expect(out.postureOverride).toEqual({});
    expect(out.orchestrationBudget).toEqual({});
  });

  it("extreme quality lean (0.05/0.9/0.05) → debate + max effort (top of the rigor ladder)", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("custom", { costWeight: 0.05, qualityWeight: 0.9, timeWeight: 0.05 })),
    );
    expect(out.postureOverride.effort).toBe("max");
    expect(out.postureOverride.minimumTier).toBe("frontier");
    expect(out.orchestrationBudget.deliberationPattern).toBe("debate");
  });

  it("strong-but-not-extreme quality (0.2/0.6/0.2) stays review, not debate", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("custom", { costWeight: 0.2, qualityWeight: 0.6, timeWeight: 0.2 })),
    );
    expect(out.orchestrationBudget.deliberationPattern).toBe("review");
  });

  it("moderate quality lean (0.25/0.45/0.30) → strong tier, not frontier", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("custom", { costWeight: 0.25, qualityWeight: 0.45, timeWeight: 0.3 })),
    );
    expect(out.postureOverride.minimumTier).toBe("strong");
    expect(out.postureOverride.budgetClass).toBe("quality_first");
  });

  it("normalizes unnormalized weights (sum != 1)", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("custom", { costWeight: 6, qualityWeight: 3, timeWeight: 1 })),
    );
    // 6/10 cost-dominant strong → frugal-leaning
    expect(out.postureOverride.budgetClass).toBe("minimize_cost");
  });
});

describe("compileGoldenTrianglePolicy — precedence & clamping", () => {
  it("residency is forced and never relaxed (records an adjustment)", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("frugal"), { policyConstraints: { residency: "local_only" } }),
    );
    expect(out.postureOverride.residencyPolicy).toBe("local_only");
    expect(out.adjustments.some((a) => a.reasonCode === "residency_clamp")).toBe(true);
  });

  it("minimum tier floor raises a lower posture tier", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("frugal"), { policyConstraints: { minimumTierFloor: "strong" } }),
    );
    expect(out.postureOverride.minimumTier).toBe("strong");
    expect(out.adjustments.some((a) => a.reasonCode === "tier_floor")).toBe(true);
  });

  it("does not lower a posture tier that already exceeds the floor", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("assured"), { policyConstraints: { minimumTierFloor: "adequate" } }),
    );
    expect(out.postureOverride.minimumTier).toBe("frontier");
    expect(out.adjustments.some((a) => a.reasonCode === "tier_floor")).toBe(false);
  });

  it("max latency ceiling clamps a higher posture latency", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("fast"), { policyConstraints: { maxLatencyCeilingMs: 5_000 } }),
    );
    expect(out.postureOverride.maxLatencyMs).toBe(5_000);
    expect(out.adjustments.some((a) => a.reasonCode === "latency_ceiling")).toBe(true);
  });
});

describe("compileGoldenTrianglePolicy — model availability & fail-closed", () => {
  it("defers when no healthy models are available", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("balanced"), { modelAvailability: { tiers: [], healthy: false } }),
    );
    expect(out.state).toBe("defer");
    expect(out.adjustments.some((a) => a.reasonCode === "no_models_available")).toBe(true);
  });

  it("blocks when a HARD tier floor cannot be met by available models", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("assured"), {
        policyConstraints: { minimumTierFloor: "frontier" },
        modelAvailability: { tiers: ["adequate", "basic"], healthy: true },
      }),
    );
    expect(out.state).toBe("blocked");
    expect(out.adjustments.some((a) => a.reasonCode === "tier_floor_unmet")).toBe(true);
  });

  it("soft-clamps the requested tier down to best available when no hard floor", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("assured"), { modelAvailability: { tiers: ["strong", "adequate"], healthy: true } }),
    );
    expect(out.state).toBe("ok");
    expect(out.postureOverride.minimumTier).toBe("strong");
    expect(out.adjustments.some((a) => a.reasonCode === "tier_clamp_availability")).toBe(true);
  });

  it("leaves the tier untouched when the requested tier is available", () => {
    const out = compileGoldenTrianglePolicy(
      input(pref("assured"), { modelAvailability: { tiers: ["frontier", "strong"], healthy: true } }),
    );
    expect(out.postureOverride.minimumTier).toBe("frontier");
    expect(out.adjustments.some((a) => a.reasonCode.startsWith("tier_clamp"))).toBe(false);
  });
});

describe("compileGoldenTrianglePolicy — invariants", () => {
  it("is deterministic (same input → deep-equal output)", () => {
    const a = compileGoldenTrianglePolicy(
      input(pref("custom", { costWeight: 0.5, qualityWeight: 0.4, timeWeight: 0.1 }), {
        policyConstraints: { minimumTierFloor: "strong", residency: "approved_cloud" },
      }),
    );
    const b = compileGoldenTrianglePolicy(
      input(pref("custom", { costWeight: 0.5, qualityWeight: 0.4, timeWeight: 0.1 }), {
        policyConstraints: { minimumTierFloor: "strong", residency: "approved_cloud" },
      }),
    );
    expect(a).toEqual(b);
  });

  it("always emits an explanation and version stamps", () => {
    const out = compileGoldenTrianglePolicy(input(pref("assured")));
    expect(out.explanation.length).toBeGreaterThan(0);
    expect(out.compilerVersion).toBe(GOLDEN_TRIANGLE_COMPILER_VERSION);
    expect(out.presetVersion).toBe("presets@1");
  });

  it("does not mutate the canonical preset table across calls", () => {
    const first = compileGoldenTrianglePolicy(
      input(pref("assured"), { policyConstraints: { minimumTierFloor: "basic" } }),
    );
    void first;
    const second = compileGoldenTrianglePolicy(input(pref("assured")));
    // If the preset table had been mutated by the first call, frontier would persist correctly,
    // but any clamp leakage would show here. Assured must still be pristine frontier.
    expect(second.postureOverride.minimumTier).toBe("frontier");
    expect(second.adjustments).toEqual([]);
  });
});
