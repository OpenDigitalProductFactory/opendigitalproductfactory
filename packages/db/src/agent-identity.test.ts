import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveAgentIdentity,
  deriveAgentDisplayName,
  AGENT_KINDS,
  COWORKER_SLUG_TO_CANONICAL_AGENT_ID,
  resolveCanonicalAgentId,
} from "./agent-identity.js";
import { COWORKER_AGENT_SEEDS } from "./workforce-seed.js";

// EP-COWORKER-RT Phase 1 — enforce the canonical coworker naming standard so the
// "names all over the place" regression (mixed casing, -agent/-specialist suffix muddle,
// raw slugs leaking into the UI) cannot recur. Every coworker resolves to a non-empty,
// hyphen-free, capitalised displayName and a kind from the closed AGENT_KINDS vocabulary.

const registryPath = join(__dirname, "..", "data", "agent_registry.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
  agents: Array<{ agent_id: string; agent_name: string; tier?: string; displayName?: string; kind?: string }>;
};

function assertCleanIdentity(displayName: string, kind: string): void {
  expect(displayName.trim()).not.toBe("");
  expect(displayName).toBe(displayName.trim());
  expect(displayName).not.toMatch(/-/); // not a raw lowercase-hyphen slug
  expect(displayName).not.toBe(displayName.toLowerCase()); // has some capitalisation
  expect(AGENT_KINDS).toContain(kind);
}

describe("agent identity derivation", () => {
  it("derives clean display names from messy slugs", () => {
    expect(deriveAgentDisplayName("finance-agent")).toBe("Finance");
    expect(deriveAgentDisplayName("marketing-specialist")).toBe("Marketing");
    expect(deriveAgentDisplayName("soc-triage-analyst")).toBe("SOC Triage Analyst");
    expect(deriveAgentDisplayName("Portfolio Analyst")).toBe("Portfolio Analyst");
  });

  it("applies overrides for vague or acronym names", () => {
    expect(resolveAgentIdentity({ agentId: "AGT-ORCH-000", name: "coo-orchestrator", tier: "orchestrator" }).displayName).toBe("COO");
    expect(resolveAgentIdentity({ agentId: "AGT-WS-BUILD", name: "build-specialist" }).kind).toBe("orchestrator");
    expect(resolveAgentIdentity({ agentId: "AGT-901", name: "architecture-agent" }).displayName).toBe("Solution Architect");
  });

  it("preserves legitimate role titles that end in Specialist", () => {
    const id = resolveAgentIdentity({ agentId: "AGT-905", name: "licensing-specialist", displayName: "Licensing & Permit Specialist" });
    expect(id.displayName).toBe("Licensing & Permit Specialist");
  });
});

describe("every registry agent resolves to a clean identity", () => {
  for (const a of registry.agents ?? []) {
    it(`${a.agent_id} → clean displayName + valid kind`, () => {
      const { displayName, kind } = resolveAgentIdentity({
        agentId: a.agent_id,
        name: a.agent_name,
        tier: a.tier,
        displayName: a.displayName,
        kind: a.kind,
      });
      assertCleanIdentity(displayName, kind);
    });
  }
});

describe("every coworker seed resolves to a clean identity", () => {
  for (const cw of COWORKER_AGENT_SEEDS) {
    it(`${cw.slugId} → clean displayName + valid kind`, () => {
      const { displayName, kind } = resolveAgentIdentity({ agentId: cw.slugId, name: cw.name, slugId: cw.slugId });
      assertCleanIdentity(displayName, kind);
    });
  }
});

describe("dual-seed slug → canonical map (BI-74FD6420)", () => {
  it("maps every dual-seed slug observed on the live install to its AGT-* twin", () => {
    expect(resolveCanonicalAgentId("coo")).toBe("AGT-ORCH-000");
    expect(resolveCanonicalAgentId("build-specialist")).toBe("AGT-WS-BUILD");
    expect(resolveCanonicalAgentId("admin-assistant")).toBe("AGT-WS-ADMIN");
    expect(resolveCanonicalAgentId("external-catalog-scout")).toBe("AGT-WS-SCOUT");
    expect(resolveCanonicalAgentId("inventory-specialist")).toBe("AGT-WS-INVENTORY");
    expect(resolveCanonicalAgentId("onboarding-coo")).toBe("AGT-WS-ONBOARD");
    // Unmapped seeds pass through unchanged.
    expect(resolveCanonicalAgentId("storefront-advisor")).toBe("storefront-advisor");
    expect(resolveCanonicalAgentId("AGT-ORCH-000")).toBe("AGT-ORCH-000");
  });

  it("maps only known dual-seed slugs (no accidental AGT-* keys)", () => {
    for (const [slug, canonical] of Object.entries(COWORKER_SLUG_TO_CANONICAL_AGENT_ID)) {
      expect(slug).not.toMatch(/^AGT-/);
      expect(canonical).toMatch(/^AGT-/);
    }
  });

  it("gives Onboarding COO a consistent Title-Case label", () => {
    expect(resolveAgentIdentity({ agentId: "AGT-WS-ONBOARD", name: "onboarding-coo" }).displayName).toBe(
      "Onboarding COO",
    );
    expect(resolveAgentIdentity({ agentId: "onboarding-coo", name: "Onboarding COO" }).displayName).toBe(
      "Onboarding COO",
    );
  });

  it("distinguishes the two Portfolio Backlog registry agents", () => {
    const mgr = resolveAgentIdentity({ agentId: "AGT-102", name: "portfolio-backlog-agent" });
    const specialist = resolveAgentIdentity({ agentId: "AGT-S2P-PFB", name: "portfolio-backlog-specialist" });
    expect(mgr.displayName).toBe("Portfolio Backlog Manager");
    expect(specialist.displayName).toBe("Portfolio Backlog Specialist");
    expect(mgr.displayName).not.toBe(specialist.displayName);
  });

  it("keeps slug agentIds as first-class seed identities for FK consumers", () => {
    // CoworkerService.providerAgentId, hive-scout tasks, and model defaults key
    // Agent.agentId by slug. Dual-seed map is for roster display only until a
    // full FK migration; seed must still create the slug row.
    for (const cw of COWORKER_AGENT_SEEDS) {
      const mapped = resolveCanonicalAgentId(cw.agentId);
      if (mapped !== cw.agentId) {
        expect(mapped).toMatch(/^AGT-/);
        // Seed still upserts by the slug agentId (not only the AGT-* twin).
        expect(cw.agentId).toBe(cw.slugId);
      }
    }
    // Catalog provider ids must remain slug keys present in COWORKER_AGENT_SEEDS.
    const seedIds = new Set(COWORKER_AGENT_SEEDS.map((c) => c.agentId));
    for (const slug of ["build-specialist", "external-catalog-scout", "marketing-specialist", "customer-advisor"]) {
      expect(seedIds.has(slug)).toBe(true);
    }
  });
});
