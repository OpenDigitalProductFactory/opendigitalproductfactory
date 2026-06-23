import { describe, it, expect } from "vitest";
import { applyPostureToRouteContext } from "./compose";

describe("applyPostureToRouteContext", () => {
  it("maps routing-shaped fields and separates effort", () => {
    const applied = applyPostureToRouteContext({
      budgetClass: "quality_first",
      reasoningDepth: "high",
      effort: "high",
      minimumTier: "frontier",
      maxLatencyMs: 30_000,
      residencyPolicy: "local_only",
    });
    expect(applied.routeContext).toEqual({
      budgetClass: "quality_first",
      reasoningDepth: "high",
      minimumTier: "frontier",
      maxLatencyMs: 30_000,
      residencyPolicy: "local_only",
    });
    // effort is NOT a routeContext field — it rides routeOptions.
    expect(applied.effort).toBe("high");
  });

  it("omits undefined fields so the result is safe to spread", () => {
    const applied = applyPostureToRouteContext({ budgetClass: "minimize_cost" });
    expect(applied.routeContext).toEqual({ budgetClass: "minimize_cost" });
    expect(applied.effort).toBeUndefined();
  });

  it("empty posture (Balanced) → empty routeContext and no effort", () => {
    const applied = applyPostureToRouteContext({});
    expect(applied.routeContext).toEqual({});
    expect(applied.effort).toBeUndefined();
  });
});
