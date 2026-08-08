// apps/web/lib/a2a/agent-card.test.ts
import { describe, it, expect } from "vitest";
import {
  projectAgentSkills,
  buildPlatformAgentCard,
  buildCoworkerAgentCard,
  A2A_PROTOCOL_VERSION,
  type A2aProvenance,
} from "./agent-card";

const PROV: A2aProvenance = {
  instanceId: "org_1",
  deviceId: "did_abc",
  signingPublicKey: "pubkey",
  signed: false,
  verification: "…",
};

const AGENT = {
  agentId: "coo",
  displayName: "Chief Operating Officer",
  description: "Runs operations.",
  skills: [
    { label: "triage_backlog", description: "Triage the backlog.", capability: "manage_backlog" },
    { label: "brief", description: "Give a briefing.", capability: null },
  ],
};

describe("A2A agent-card projection (Slice 6) — field allowlist", () => {
  it("projects skills to id/name/description/tags only", () => {
    const skills = projectAgentSkills(AGENT);
    expect(skills).toEqual([
      { id: "coo:triage_backlog", name: "triage_backlog", description: "Triage the backlog.", tags: ["manage_backlog"] },
      { id: "coo:brief", name: "brief", description: "Give a briefing.", tags: [] },
    ]);
  });

  it("coworker card carries only name/description/skills + provenance — no internal fields", () => {
    const card = buildCoworkerAgentCard(AGENT, PROV);
    expect(card.name).toBe("Chief Operating Officer");
    expect(card.description).toBe("Runs operations.");
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
    expect(card.provenance.signed).toBe(false);
    // The serialized card must never leak internal governance fields.
    const json = JSON.stringify(card);
    for (const leak of ["humanSupervisorId", "escalatesTo", "delegatesTo", "hitlTier", "portfolioId", "sensitivity", "it4itSections"]) {
      expect(json).not.toContain(leak);
    }
  });

  it("platform card prefixes coworker skills with the coworker name", () => {
    const card = buildPlatformAgentCard("Example Org", [AGENT], PROV);
    expect(card.name).toBe("Example Org");
    expect(card.skills.map((s) => s.name)).toEqual([
      "Chief Operating Officer: triage_backlog",
      "Chief Operating Officer: brief",
    ]);
  });

  it("platform card with no exported agents is a valid empty-skills card (deny-by-default)", () => {
    const card = buildPlatformAgentCard("Example Org", [], PROV);
    expect(card.skills).toEqual([]);
    expect(card.protocolVersion).toBe(A2A_PROTOCOL_VERSION);
  });
});
