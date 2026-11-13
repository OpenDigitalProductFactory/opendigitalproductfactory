import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@dpf/db", () => ({ prisma: {} }));

import { loadArchetypeRosterCoverage } from "./archetype-roster-coverage.server";

describe("loadArchetypeRosterCoverage", () => {
  it("names missing roles for the storefront archetype plus orchestrators", async () => {
    const coverage = await loadArchetypeRosterCoverage({
      storefrontConfig: {
        findFirst: async () => ({ archetype: { archetypeId: "florist" } }),
      },
      agent: {
        findMany: async () => [
          { agentId: "AGT-WS-SECURITY" },
          { agentId: "security-engineer" },
        ],
      },
    });
    expect(coverage.archetypeId).toBe("florist");
    expect(coverage.staffed).toEqual(["security-engineer"]);
    expect(coverage.staffedCount).toBe(1);
    expect(coverage.missing).toEqual(expect.arrayContaining(["coo-orchestrator"]));
    expect(coverage.requiredCount).toBeGreaterThan(coverage.staffedCount);
  });

  it("falls back to platform orchestrators when no storefront archetype is set", async () => {
    const coverage = await loadArchetypeRosterCoverage({
      storefrontConfig: {
        findFirst: async () => null,
      },
      agent: {
        findMany: async () => [],
      },
    });
    expect(coverage.archetypeId).toBeNull();
    expect(coverage.staffedCount).toBe(0);
    expect(coverage.missing).toEqual(expect.arrayContaining(["coo-orchestrator"]));
    expect(coverage.requiredCount).toBe(9);
  });
});
