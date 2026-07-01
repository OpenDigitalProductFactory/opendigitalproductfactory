import { describe, expect, it } from "vitest";
import { COWORKER_SERVICE_CATALOG_SERVICE_SEEDS } from "@dpf/db";
import { marketingPack } from "./marketing-pack";

// Drift guard (BI-4C5F7A2D): neither A2A nor the coworker service catalog
// auto-derives from the tool registry — a coworker's services are explicit seed
// records. Without this test a newly-added marketing-pack tool would be
// invocable but invisible to A2A discovery and list_coworker_services, silently.
// Assert every marketing-pack tool is backed by a marketing-specialist service.
describe("marketing tools are covered by the coworker service catalog", () => {
  const backedToolNames = new Set(
    COWORKER_SERVICE_CATALOG_SERVICE_SEEDS.filter(
      (service) => service.providerAgentId === "marketing-specialist",
    ).flatMap((service) => service.backingToolNames),
  );

  it("has at least one marketing-specialist service", () => {
    expect(backedToolNames.size).toBeGreaterThan(0);
  });

  for (const tool of marketingPack.definitions) {
    it(`backs "${tool.name}" with a catalog service`, () => {
      expect(backedToolNames.has(tool.name), tool.name).toBe(true);
    });
  }
});
