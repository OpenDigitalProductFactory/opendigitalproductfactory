import { describe, expect, it } from "vitest";
import {
  resolveCoworkerIdentity,
  getCanonicalAgentId,
  type CoworkerRegistry,
} from "./coworker-identity";

const fixtureRegistry: CoworkerRegistry = {
  agents: [
    {
      agentId: "AGT-WS-INVENTORY",
      agentName: "inventory-specialist",
      displayName: "Digital Product Estate Specialist",
      aliases: ["estate-specialist"],
    },
    {
      agentId: "AGT-WS-PORTFOLIO",
      agentName: "portfolio-advisor",
      displayName: "Portfolio Analyst",
    },
    {
      agentId: "AGT-ORCH-200",
      agentName: "explore-orchestrator",
    },
  ],
};

describe("resolveCoworkerIdentity (fixture registry)", () => {
  it("resolves by agent_id", () => {
    const result = resolveCoworkerIdentity("AGT-WS-INVENTORY", fixtureRegistry);
    expect(result?.agentId).toBe("AGT-WS-INVENTORY");
    expect(result?.displayName).toBe("Digital Product Estate Specialist");
  });

  it("resolves by agent_name (the persona slug)", () => {
    const result = resolveCoworkerIdentity("inventory-specialist", fixtureRegistry);
    expect(result?.agentId).toBe("AGT-WS-INVENTORY");
  });

  it("resolves by alias", () => {
    const result = resolveCoworkerIdentity("estate-specialist", fixtureRegistry);
    expect(result?.agentId).toBe("AGT-WS-INVENTORY");
    expect(result?.displayName).toBe("Digital Product Estate Specialist");
  });

  it("agent_name and alias matches are case-insensitive", () => {
    expect(resolveCoworkerIdentity("Inventory-Specialist", fixtureRegistry)?.agentId).toBe(
      "AGT-WS-INVENTORY",
    );
    expect(resolveCoworkerIdentity("ESTATE-SPECIALIST", fixtureRegistry)?.agentId).toBe(
      "AGT-WS-INVENTORY",
    );
  });

  it("agent_id matching is case-sensitive (registry IDs are canonical uppercase)", () => {
    expect(resolveCoworkerIdentity("agt-ws-inventory", fixtureRegistry)).toBeNull();
  });

  it("returns null for unknown input", () => {
    expect(resolveCoworkerIdentity("nonsense", fixtureRegistry)).toBeNull();
    expect(resolveCoworkerIdentity("", fixtureRegistry)).toBeNull();
  });

  it("agents with no displayName resolve cleanly (displayName remains undefined)", () => {
    const result = resolveCoworkerIdentity("explore-orchestrator", fixtureRegistry);
    expect(result?.agentId).toBe("AGT-ORCH-200");
    expect(result?.displayName).toBeUndefined();
    expect(result?.aliases).toBeUndefined();
  });
});

describe("getCanonicalAgentId", () => {
  it("returns the canonical agent_id from a persona slug", () => {
    expect(getCanonicalAgentId("inventory-specialist", fixtureRegistry)).toBe(
      "AGT-WS-INVENTORY",
    );
  });

  it("returns the canonical agent_id from an alias", () => {
    expect(getCanonicalAgentId("estate-specialist", fixtureRegistry)).toBe(
      "AGT-WS-INVENTORY",
    );
  });

  it("returns null for unknown input", () => {
    expect(getCanonicalAgentId("nope", fixtureRegistry)).toBeNull();
  });
});

describe("resolveCoworkerIdentity edge cases", () => {
  it("agents with empty aliases array do not break the alias loop", () => {
    const reg: CoworkerRegistry = {
      agents: [
        {
          agentId: "AGT-EDGE-1",
          agentName: "edge-one",
          aliases: [],
        },
      ],
    };
    expect(resolveCoworkerIdentity("AGT-EDGE-1", reg)?.agentId).toBe("AGT-EDGE-1");
    expect(resolveCoworkerIdentity("edge-one", reg)?.agentId).toBe("AGT-EDGE-1");
    expect(resolveCoworkerIdentity("not-a-real-alias", reg)).toBeNull();
  });

  it("agent_id wins over an alias on a different agent that happens to match", () => {
    // Edge case: agent B has an alias that collides with agent A's agent_id.
    // The agent_id pass runs first, so agent A wins for that lookup.
    const reg: CoworkerRegistry = {
      agents: [
        { agentId: "AGT-A", agentName: "agent-a" },
        { agentId: "AGT-B", agentName: "agent-b", aliases: ["AGT-A"] },
      ],
    };
    const result = resolveCoworkerIdentity("AGT-A", reg);
    expect(result?.agentId).toBe("AGT-A");
    expect(result?.agentName).toBe("agent-a");
  });
});

describe("resolveCoworkerIdentity (default registry source)", () => {
  it("loads packages/db/data/agent_registry.json when no registry is passed", () => {
    // The real registry has AGT-WS-INVENTORY but does not yet carry the
    // estate-specialist alias or displayName (those land in Chunk 6 Task 6.1).
    // Resolving by agent_id should still work today via the default loader.
    const result = resolveCoworkerIdentity("AGT-WS-INVENTORY");
    expect(result?.agentId).toBe("AGT-WS-INVENTORY");
    expect(result?.agentName).toBe("inventory-specialist");
  });
});

describe("resolveCoworkerIdentity (default registry source) — Chunk 6 alias landed", () => {
  it("AGT-WS-INVENTORY now carries displayName 'Digital Product Estate Specialist'", () => {
    const result = resolveCoworkerIdentity("AGT-WS-INVENTORY");
    expect(result?.displayName).toBe("Digital Product Estate Specialist");
  });

  it("'estate-specialist' alias resolves to AGT-WS-INVENTORY via the default loader", () => {
    expect(resolveCoworkerIdentity("estate-specialist")?.agentId).toBe("AGT-WS-INVENTORY");
  });

  it("'inventory-specialist' alias still resolves (compatibility)", () => {
    expect(resolveCoworkerIdentity("inventory-specialist")?.agentId).toBe("AGT-WS-INVENTORY");
  });
});
