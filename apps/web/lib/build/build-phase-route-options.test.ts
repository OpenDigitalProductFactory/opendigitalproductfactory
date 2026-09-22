import { describe, expect, it } from "vitest";
import { buildPhaseRouteOptions, BUILD_PHASE_ROUTE_OPTIONS } from "./build-phase-route-options";

describe("buildPhaseRouteOptions (BI-F84887FF)", () => {
  it("never demands token streaming", () => {
    expect(BUILD_PHASE_ROUTE_OPTIONS.requiresStreaming).toBe(false);
    expect(buildPhaseRouteOptions().requiresStreaming).toBe(false);
  });

  it("keeps per-call extras and still turns streaming off", () => {
    const o = buildPhaseRouteOptions({ budgetClass: "minimize_cost", buildId: "FB-1", requiresStreaming: true });
    expect(o.budgetClass).toBe("minimize_cost");
    expect(o.buildId).toBe("FB-1");
    expect(o.requiresStreaming).toBe(false);
  });
});
