import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAgentIdentity, deriveAgentDisplayName, AGENT_KINDS } from "./agent-identity.js";
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
