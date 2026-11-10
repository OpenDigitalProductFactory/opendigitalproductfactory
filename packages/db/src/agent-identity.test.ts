import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveAgentIdentity,
  deriveAgentDisplayName,
  AGENT_KINDS,
  COWORKER_SLUG_TO_CANONICAL_AGENT_ID,
  resolveCanonicalAgentId,
  canonicalDisplayNameFor,
  ENTERPRISE_ARCHITECT_AGENT_ID,
  ENTERPRISE_ARCHITECT_DISPLAY_NAME,
} from "./agent-identity.js";
import { COWORKER_AGENT_SEEDS, ONBOARDING_AGENT_GRANTS } from "./workforce-seed.js";

// EP-COWORKER-RT Phase 1 — enforce the canonical coworker naming standard so the
// "names all over the place" regression (mixed casing, -agent/-specialist suffix muddle,
// raw slugs leaking into the UI) cannot recur. Every coworker resolves to a non-empty,
// hyphen-free, capitalised displayName and a kind from the closed AGENT_KINDS vocabulary.

const registryPath = join(__dirname, "..", "data", "agent_registry.json");
const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
  agents: Array<{ agent_id: string; agent_name: string; tier?: string; displayName?: string; kind?: string; status?: string }>;
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
  it("canonically homes every workforce coworker", () => {
    const registryIds = new Set(registry.agents.map((agent) => agent.agent_id));

    for (const coworker of COWORKER_AGENT_SEEDS) {
      const canonical = COWORKER_SLUG_TO_CANONICAL_AGENT_ID[coworker.slugId];
      expect(canonical, `${coworker.slugId} is roster-only`).toMatch(/^AGT-/);
      expect(registryIds.has(canonical), `${coworker.slugId} maps to missing ${canonical}`).toBe(true);
    }
  });

  it("projects every active canonical agent onto the workforce roster", () => {
    const seededSlugs = new Set([
      ...COWORKER_AGENT_SEEDS.map((coworker) => coworker.slugId),
      ...Object.keys(ONBOARDING_AGENT_GRANTS),
    ]);
    const canonicalToSlug = new Map(
      Object.entries(COWORKER_SLUG_TO_CANONICAL_AGENT_ID).map(([slug, canonical]) => [canonical, slug]),
    );

    for (const agent of registry.agents.filter((candidate) => candidate.status === "active")) {
      const slug = canonicalToSlug.get(agent.agent_id);
      expect(slug, `${agent.agent_id} is active-registry-only`).toBeTruthy();
      expect(seededSlugs.has(slug!), `${agent.agent_id} maps to unseeded ${slug}`).toBe(true);
    }
  });

  it("maps every dual-seed slug observed on the live install to its AGT-* twin", () => {
    expect(resolveCanonicalAgentId("coo")).toBe("AGT-ORCH-000");
    expect(resolveCanonicalAgentId("build-specialist")).toBe("AGT-WS-BUILD");
    expect(resolveCanonicalAgentId("admin-assistant")).toBe("AGT-WS-ADMIN");
    expect(resolveCanonicalAgentId("external-catalog-scout")).toBe("AGT-WS-SCOUT");
    expect(resolveCanonicalAgentId("inventory-specialist")).toBe("AGT-WS-INVENTORY");
    expect(resolveCanonicalAgentId("onboarding-coo")).toBe("AGT-WS-ONBOARD");
    expect(resolveCanonicalAgentId("farm-ranch-steward")).toBe("AGT-WS-FARM-RANCH");
    expect(resolveCanonicalAgentId("storefront-advisor")).toBe("AGT-WS-STOREFRONT");
    expect(resolveCanonicalAgentId("AGT-ORCH-000")).toBe("AGT-ORCH-000");
  });

  it("maps only known dual-seed slugs (no accidental AGT-* keys)", () => {
    for (const [slug, canonical] of Object.entries(COWORKER_SLUG_TO_CANONICAL_AGENT_ID)) {
      expect(slug).not.toMatch(/^AGT-/);
      expect(canonical).toMatch(/^AGT-/);
    }
  });

  it("collapses the Change Reviewer registry mirror onto its coworker slug", () => {
    expect(resolveCanonicalAgentId("change-reviewer")).toBe("AGT-WS-REVIEW");
    expect(resolveAgentIdentity({ agentId: "change-reviewer", name: "change-reviewer" }).displayName).toBe(
      "Change Reviewer",
    );
    expect(resolveAgentIdentity({ agentId: "AGT-WS-REVIEW", name: "change-reviewer" }).displayName).toBe(
      "Change Reviewer",
    );
  });

  it("gives Onboarding COO a consistent Title-Case label", () => {
    expect(resolveAgentIdentity({ agentId: "AGT-WS-ONBOARD", name: "onboarding-coo" }).displayName).toBe(
      "Onboarding COO",
    );
    expect(resolveAgentIdentity({ agentId: "onboarding-coo", name: "Onboarding COO" }).displayName).toBe(
      "Onboarding COO",
    );
  });

  it("gives Farm & Ranch Steward one canonical identity across both seed paths", () => {
    expect(
      resolveAgentIdentity({ agentId: "AGT-WS-FARM-RANCH", name: "farm-ranch-steward" }).displayName,
    ).toBe("Farm & Ranch Steward");
    expect(
      resolveAgentIdentity({
        agentId: "farm-ranch-steward",
        slugId: "farm-ranch-steward",
        name: "Farm & Ranch Steward",
      }).displayName,
    ).toBe("Farm & Ranch Steward");
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

// BI-29F07F46. One coworker answered to two names depending on which plane you
// observed it from: the roster derived "EA Architect" by tokenizing the slug
// `ea-architect` (a name authored nowhere, so grepping for it finds no origin),
// while the seed, the reviewer prompts, the HR-300 role, the profession
// registry and the wsid-enterprise-architecture profile all said "Enterprise
// Architect". An operator seeing both concluded they were different actors.
describe("Enterprise Architect answers to one name (BI-29F07F46)", () => {
  it("resolves the same display name from BOTH seed paths", () => {
    // The dual-seed rows carry different agentIds and different `name` values,
    // so the override must be keyed on both or the two planes diverge again.
    expect(
      resolveAgentIdentity({ agentId: "AGT-WS-EA", name: "ea-architect" }).displayName,
    ).toBe(ENTERPRISE_ARCHITECT_DISPLAY_NAME);
    expect(
      resolveAgentIdentity({
        agentId: "ea-architect",
        slugId: "ea-architect",
        name: "Enterprise Architect",
      }).displayName,
    ).toBe(ENTERPRISE_ARCHITECT_DISPLAY_NAME);
  });

  it("no longer derives the slug-tokenized name that appeared nowhere else", () => {
    // Guards the derivation, not just the constant: "EA Architect" is what
    // ACRONYMS + Title Case produces from the slug, and it must not resurface.
    expect(deriveAgentDisplayName("ea-architect")).toBe("EA Architect");
    expect(ENTERPRISE_ARCHITECT_DISPLAY_NAME).not.toBe("EA Architect");
    expect(
      resolveAgentIdentity({ agentId: "AGT-WS-EA", name: "ea-architect" }).displayName,
    ).not.toBe("EA Architect");
  });

  it("keeps the exported prompt constant bound to the override table", () => {
    // The reviewer prompts and static labels interpolate this constant instead
    // of a literal, so renaming the coworker in one place renames it everywhere.
    expect(canonicalDisplayNameFor(ENTERPRISE_ARCHITECT_AGENT_ID)).toBe(
      ENTERPRISE_ARCHITECT_DISPLAY_NAME,
    );
    expect(canonicalDisplayNameFor("ea-architect")).toBe(ENTERPRISE_ARCHITECT_DISPLAY_NAME);
  });

  it("stays distinct from its muddying near-neighbours", () => {
    // AGT-901 Solution Architect / AGT-121 Architecture Definition / AGT-181
    // Architecture Guardrail / AGT-BUILD-DA Build Data Architect are DIFFERENT
    // coworkers whose names all read "architect-ish". Converging the EA name
    // must not collide with any of them.
    const neighbours = [
      { agentId: "AGT-901", name: "architecture-agent", expected: "Solution Architect" },
      { agentId: "AGT-121", name: "architecture-definition-agent", expected: "Architecture Definition" },
      { agentId: "AGT-181", name: "architecture-guardrail-agent", expected: "Architecture Guardrail" },
      { agentId: "AGT-BUILD-DA", name: "build-data-architect", expected: "Build Data Architect" },
    ];
    for (const n of neighbours) {
      const displayName = resolveAgentIdentity({ agentId: n.agentId, name: n.name }).displayName;
      expect(displayName, n.agentId).toBe(n.expected);
      expect(displayName, n.agentId).not.toBe(ENTERPRISE_ARCHITECT_DISPLAY_NAME);
    }
  });
});
