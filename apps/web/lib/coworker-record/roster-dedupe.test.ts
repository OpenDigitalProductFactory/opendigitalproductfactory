// BI-74FD6420 — dual-seed alias rows must not appear beside their AGT-* twin.
import { describe, expect, it } from "vitest";
import { COWORKER_SLUG_TO_CANONICAL_AGENT_ID } from "@dpf/db/agent-identity";
import { dropDualSeedAliasAgents } from "./roster";

describe("dropDualSeedAliasAgents (BI-74FD6420)", () => {
  it("drops known slug alias rows when the canonical AGT-* twin is present", () => {
    const agents = [
      { agentId: "AGT-ORCH-000", displayName: "COO" },
      { agentId: "coo", displayName: "COO" },
      { agentId: "AGT-WS-BUILD", displayName: "Build Lead" },
      { agentId: "build-specialist", displayName: "Build Lead" },
      { agentId: "AGT-WS-ADMIN", displayName: "Platform Admin" },
      { agentId: "admin-assistant", displayName: "Platform Admin" },
      { agentId: "AGT-WS-SCOUT", displayName: "External Catalog Scout" },
      { agentId: "external-catalog-scout", displayName: "External Catalog Scout" },
      { agentId: "AGT-WS-INVENTORY", displayName: "Digital Product Estate Specialist" },
      { agentId: "inventory-specialist", displayName: "Digital Product Estate Specialist" },
      { agentId: "AGT-WS-STOREFRONT", displayName: "Storefront Operations Manager" },
      { agentId: "storefront-advisor", displayName: "Storefront Operations Manager" },
    ];

    const kept = dropDualSeedAliasAgents(agents);
    const ids = kept.map((a) => a.agentId).sort();

    expect(ids).toEqual(
      [
        "AGT-ORCH-000",
        "AGT-WS-ADMIN",
        "AGT-WS-BUILD",
        "AGT-WS-INVENTORY",
        "AGT-WS-SCOUT",
        "AGT-WS-STOREFRONT",
      ].sort(),
    );
    // No residual dual-seed aliases for the known map keys.
    for (const slug of Object.keys(COWORKER_SLUG_TO_CANONICAL_AGENT_ID)) {
      if (slug === "onboarding-coo") continue; // not in fixture
      expect(ids).not.toContain(slug);
    }
  });

  it("hides a known slug row when its canonical detail record is absent", () => {
    const agents = [
      { agentId: "coo", displayName: "COO" },
      { agentId: "build-specialist", displayName: "Build Lead" },
    ];
    const kept = dropDualSeedAliasAgents(agents);
    expect(kept).toEqual([]);
  });

  it("hides mapped canonical rows when their executable slug is absent", () => {
    const agents = [
      { agentId: "AGT-ORCH-000", displayName: "COO" },
      { agentId: "AGT-WS-BUILD", displayName: "Build Lead" },
    ];
    expect(dropDualSeedAliasAgents(agents)).toEqual([]);
  });

  it("keeps an unmapped coworker whose canonical and runtime identity are the same", () => {
    const agents = [
      { agentId: "unmapped-advisor", displayName: "Unmapped Advisor" },
    ];
    expect(dropDualSeedAliasAgents(agents)).toEqual(agents);
  });

  it("covers every dual-seed pair observed on the live install", () => {
    // Live evidence 2026-07-11: COO, Build Lead, Platform Admin, Scout,
    // Inventory, Onboarding COO each had a slug twin beside the AGT-* row.
    const livePairs: Array<[string, string]> = [
      ["coo", "AGT-ORCH-000"],
      ["build-specialist", "AGT-WS-BUILD"],
      ["admin-assistant", "AGT-WS-ADMIN"],
      ["external-catalog-scout", "AGT-WS-SCOUT"],
      ["inventory-specialist", "AGT-WS-INVENTORY"],
      ["onboarding-coo", "AGT-WS-ONBOARD"],
    ];
    for (const [slug, canonical] of livePairs) {
      expect(COWORKER_SLUG_TO_CANONICAL_AGENT_ID[slug]).toBe(canonical);
    }
  });
});

// BI-6A1BFE77 — the collapse map must stay in sync with the seeded workforce.
import { uncoveredDualSeedDisplayNames } from "./selectable-coworker";

describe("uncoveredDualSeedDisplayNames (BI-6A1BFE77)", () => {
  it("returns empty when every dual-seed pair is covered by the map", () => {
    const agents = [
      { agentId: "AGT-ORCH-000", displayName: "COO" },
      { agentId: "coo", displayName: "COO" },
      { agentId: "AGT-WS-EA", displayName: "Enterprise Architect" },
      { agentId: "ea-architect", displayName: "Enterprise Architect" },
      { agentId: "storefront-advisor", displayName: "Storefront Operations Manager" },
    ];
    expect(uncoveredDualSeedDisplayNames(agents)).toEqual([]);
  });

  it("FLAGS an uncovered dual-seed pair — the exact regression the BI names", () => {
    // A newly-established coworker seeded in BOTH forms whose slug is NOT in the
    // map. Before the map fix, this is what UX Design Critic (AGT-906 /
    // ux-design-critic) looked like: two rows survive the collapse.
    const agents = [
      { agentId: "AGT-999", displayName: "Brand New Critic" },
      { agentId: "brand-new-critic", displayName: "Brand New Critic" },
    ];
    expect(uncoveredDualSeedDisplayNames(agents)).toEqual(["Brand New Critic"]);
  });

  it("confirms the ux-design-critic fix: AGT-906 + ux-design-critic now collapse", () => {
    const agents = [
      { agentId: "AGT-906", displayName: "UX Design Critic" },
      { agentId: "ux-design-critic", displayName: "UX Design Critic" },
    ];
    expect(uncoveredDualSeedDisplayNames(agents)).toEqual([]);
  });

  it("ignores archived / non-production twins (they never render)", () => {
    const agents = [
      { agentId: "AGT-777", displayName: "Retired Twin", status: "active", lifecycleStage: "retired" },
      { agentId: "retired-twin", displayName: "Retired Twin", status: "active", lifecycleStage: "production" },
    ];
    // Only one renders (the production slug row), so no visible duplicate.
    expect(uncoveredDualSeedDisplayNames(agents)).toEqual([]);
  });
});
