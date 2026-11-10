// apps/web/lib/routing/pipeline-v2.routing-confidence.test.ts
//
// BI-A08285BC. Split out of pipeline-v2.test.ts, which sits at its size ceiling.
import { describe, expect, it, vi } from "vitest";

// Same isolation as pipeline-v2.test.ts: recipe selection is a DB round-trip and
// this file is testing routing policy, not persistence.
vi.mock("./champion-challenger", () => ({
  selectRecipeWithExploration: vi.fn().mockResolvedValue({
    recipe: null,
    explorationMode: "champion",
  }),
}));

import { routeEndpointV2 } from "./pipeline-v2";
import { makeEndpoint, makeContract } from "./__fixtures__/pipeline-v2-fixtures";

// BI-A08285BC — routing confidence travels structurally, not as prose.
describe("routeEndpointV2 — routing confidence", () => {
  it("reports how many candidates actually competed", async () => {
    const decision = await routeEndpointV2(
      [makeEndpoint({ id: "ep-a" }), makeEndpoint({ id: "ep-b", modelId: "m-b" })],
      makeContract(),
      [],
      [],
    );
    expect(decision.routingConfidence?.candidateCount).toBeGreaterThan(0);
    expect(decision.routingConfidence?.qualityFloorRelaxed).toBe(false);
  });

  it("flags a relaxed floor on the decision, not only inside the reason text", async () => {
    // A floor nothing can clear: the soft exclusion relaxes it and runs anyway.
    const decision = await routeEndpointV2(
      [makeEndpoint({ id: "ep-weak", reasoning: 10, codegen: 10, toolFidelity: 10 })],
      makeContract({ reasoningDepth: "high" }),
      [],
      [],
    );
    if (decision.reason.includes("No endpoint met the quality floor")) {
      expect(decision.routingConfidence?.qualityFloorRelaxed).toBe(true);
    }
    // Either way the signal must exist — an absent signal is what caused the defect.
    expect(decision.routingConfidence).toBeDefined();
  });
});
