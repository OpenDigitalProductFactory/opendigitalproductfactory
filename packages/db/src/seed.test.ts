import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseRoleId, parseAgentTier, parseAgentType } from "./seed-helpers.js";
import {
  COWORKER_AGENT_SEEDS,
  HARDCODED_COWORKER_GRANTS,
} from "./workforce-seed.js";

describe("seed helpers", () => {
  it("parseRoleId accepts valid HR-xxx codes", () => {
    expect(parseRoleId("HR-000")).toBe("HR-000");
    expect(parseRoleId("HR-500")).toBe("HR-500");
  });

  it("parseRoleId rejects invalid codes", () => {
    expect(() => parseRoleId("INVALID")).toThrow();
  });

  it("parseAgentTier extracts numeric tier from AGT id", () => {
    expect(parseAgentTier("AGT-ORCH-000")).toBe(1);
    expect(parseAgentTier("AGT-100")).toBe(2);
    expect(parseAgentTier("AGT-900")).toBe(3);
  });

  it("parseAgentType classifies correctly", () => {
    expect(parseAgentType("AGT-ORCH-000")).toBe("orchestrator");
    expect(parseAgentType("AGT-100")).toBe("specialist");
    expect(parseAgentType("AGT-900")).toBe("cross-cutting");
  });

  it("does not export seedEaReferenceModels from the runtime db barrel", async () => {
    const mod = await import("./index.js");
    expect("seedEaReferenceModels" in mod).toBe(false);
  }, 15_000);

  it("exports seedEaReferenceModels from the seed module", async () => {
    const mod = await import("./seed-ea-reference-models.js");
    expect(typeof mod.seedEaReferenceModels).toBe("function");
  }, 15_000);

  it("exports seedEaStructureRules from the seed module", async () => {
    const mod = await import("./seed-ea-structure-rules.js");
    expect(typeof mod.seedEaStructureRules).toBe("function");
  }, 15_000);
});

describe("coworker seed invariants", () => {
  const professionRegistry = JSON.parse(
    readFileSync(new URL("../../../docs/professions/registry.json", import.meta.url), "utf8"),
  ) as { families: Array<{ professionKey: string; roles: string[] }> };

  it("includes marketing-specialist in the coworker seed roster", () => {
    expect(COWORKER_AGENT_SEEDS.map((seed) => seed.agentId)).toContain("marketing-specialist");
  });

  it("includes storefront-advisor in the coworker seed roster", () => {
    expect(COWORKER_AGENT_SEEDS.map((seed) => seed.agentId)).toContain("storefront-advisor");
  });

  it("grants marketing-specialist marketing_read and marketing_write", () => {
    expect(HARDCODED_COWORKER_GRANTS["marketing-specialist"]).toEqual(
      expect.arrayContaining(["marketing_read", "marketing_write"]),
    );
  });

  it("grants customer-advisor the CRM grants it operates with — not backlog_write", () => {
    // The Customer Success Manager resolves its runtime grants from THIS map (the
    // slug agent row), so the CRM grants must be here. Regression guard for the
    // bug where it held backlog_write + marketing_read and NO crm_* grants, which
    // stripped every CRM tool from its surface (it filed backlog items instead of
    // creating accounts).
    const grants = HARDCODED_COWORKER_GRANTS["customer-advisor"];
    expect(grants).toEqual(expect.arrayContaining(["crm_read", "crm_write"]));
    expect(grants).not.toContain("backlog_write");
    expect(grants).not.toContain("marketing_read");
  });

  it("grants platform-engineer (AI Ops Engineer) backlog_read + backlog_write so it can file readiness findings", () => {
    // The AI Ops Engineer resolves its runtime grants from THIS map, not
    // agent_registry.json. Regression guard for BI-CAP-CBC41758: it observed
    // capability needs on /platform/ai/readiness but its grant set had dropped
    // backlog_read/backlog_write, so it could not file or track the issues it found.
    const grants = HARDCODED_COWORKER_GRANTS["platform-engineer"];
    expect(grants).toEqual(expect.arrayContaining(["backlog_read", "backlog_write"]));
  });

  it("keeps inventory-specialist scoped to estate stewardship — no AI-ops agent_control_read", () => {
    // Regression guard for BI-CAP-C2565D94 (tool-surface overload). The Digital
    // Product Estate Specialist stewards products via registry_*/backlog; the
    // AI-ops agent_control_read grant (add_provider, configure_gateway_scan,
    // manage_coworker_tool_grant, …) was out-of-role and only inflated its surface.
    const grants = HARDCODED_COWORKER_GRANTS["inventory-specialist"];
    expect(grants).toEqual(expect.arrayContaining(["registry_read", "registry_write", "backlog_read", "backlog_write"]));
    expect(grants).not.toContain("agent_control_read");
    expect(grants).not.toContain("portfolio_read");
  });

  it("binds every hardcoded coworker seed to one profession family", () => {
    const registeredRoles = new Map<string, string>();
    const duplicates: string[] = [];
    for (const family of professionRegistry.families) {
      for (const role of family.roles) {
        const existing = registeredRoles.get(role);
        if (existing) duplicates.push(`${role} in both ${existing} and ${family.professionKey}`);
        registeredRoles.set(role, family.professionKey);
      }
    }

    const unmapped = COWORKER_AGENT_SEEDS.filter(
      (seed) => !registeredRoles.has(seed.slugId) && !registeredRoles.has(seed.agentId),
    );

    expect(duplicates, `Duplicate profession role bindings: ${duplicates.join("; ")}`).toHaveLength(0);
    expect(unmapped, `Unmapped hardcoded coworkers: ${unmapped.map((seed) => seed.slugId).join(", ")}`).toHaveLength(0);
  });
});
