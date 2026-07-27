import { describe, expect, it } from "vitest";
// Import via the subpath (not bare "@dpf/db", which the apps/web vitest alias
// maps to client.ts, exposing only the prisma client — not the seed barrel).
import { COWORKER_SERVICE_CATALOG_SERVICE_SEEDS } from "@dpf/db/coworker-service-catalog-seed";
import { marketingPack } from "./marketing-pack";
import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { VERIFIED_COWORKER_SERVICE_TOOL_NAMES } from "@/lib/coworker-service-catalog/registered-service-tools";

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

  it("registers every tool backing the first available Marketing service", () => {
    const registered = new Set(PLATFORM_TOOLS.map((tool) => tool.name));
    const campaignService = COWORKER_SERVICE_CATALOG_SERVICE_SEEDS.find(
      (service) => service.serviceId === "svc-marketing-campaign-execution",
    );

    expect(campaignService).toBeDefined();
    expect(campaignService?.backingToolNames).toEqual([
      ...VERIFIED_COWORKER_SERVICE_TOOL_NAMES,
    ]);
    for (const toolName of VERIFIED_COWORKER_SERVICE_TOOL_NAMES) {
      expect(registered.has(toolName), toolName).toBe(true);
    }
  });
});
