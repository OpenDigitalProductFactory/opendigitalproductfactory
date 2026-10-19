import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: { agent: { findFirst: vi.fn() } },
}));
vi.mock("@dpf/db", () => db);

import {
  coworkerNotBoundRefusal,
  coworkerNotBoundResult,
  currentCoworkerId,
  resolveCoworkerBacklogScope,
} from "./coworker-scope";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("currentCoworkerId", () => {
  it("returns the trimmed agentId from context", () => {
    expect(currentCoworkerId({ agentId: " agent-a " })).toBe("agent-a");
  });
  it("returns null, never throws, when the connection has no acting coworker", () => {
    expect(currentCoworkerId({})).toBeNull();
    expect(currentCoworkerId({ agentId: "  " })).toBeNull();
    expect(currentCoworkerId(undefined)).toBeNull();
  });
});

describe("agentless-connection results", () => {
  it("answers a self-describing read with success and says why there is no profile", () => {
    expect(coworkerNotBoundResult()).toMatchObject({
      success: true,
      data: { agentBound: false, recovery: expect.stringMatching(/OAuth/) },
    });
  });
  it("refuses a coworker-only action without throwing", () => {
    expect(coworkerNotBoundRefusal()).toMatchObject({
      success: false,
      error: "coworker_not_bound",
      data: { agentBound: false },
    });
  });
});

describe("resolveCoworkerBacklogScope", () => {
  it("unions owned, area, and occupation arms for a fully-scoped coworker", async () => {
    db.prisma.agent.findFirst.mockResolvedValue({
      agentId: "agent-a",
      slugId: "agent-a",
      portfolioId: "pf-A",
      valueStream: "operate",
    });

    const scope = await resolveCoworkerBacklogScope("agent-a", "/ops");

    expect(scope.portfolioId).toBe("pf-A");
    expect(scope.valueStream).toBe("operate");
    expect(scope.occupationArmApplied).toBe(true);
    expect(scope.orClauses).toEqual([
      { agentId: "agent-a" },
      { claimedByAgentId: "agent-a" },
      { portfolioId: "pf-A" },
      { taxonomyNode: { portfolioId: "pf-A" } },
      { businessCapabilityLinks: { some: { capability: { it4itValueStreams: { has: "operate" } } } } },
    ]);
  });

  it("cannot leak another coworker's portfolio — clauses reference only the caller's own scope", async () => {
    db.prisma.agent.findFirst.mockResolvedValue({
      agentId: "agent-a",
      slugId: "agent-a",
      portfolioId: "pf-A",
      valueStream: "operate",
    });

    const scope = await resolveCoworkerBacklogScope("agent-a", "/ops");

    // A portfolio-B-only BI can never match: no clause references pf-B or any
    // foreign identity. Scope is derived solely from the agent row.
    const serialized = JSON.stringify(scope.orClauses);
    expect(serialized).not.toContain("pf-B");
    expect(serialized).not.toContain("agent-b");
  });

  it("skips the occupation arm (degraded) for a cross-cutting value stream", async () => {
    db.prisma.agent.findFirst.mockResolvedValue({
      agentId: "agent-a",
      slugId: "agent-a",
      portfolioId: "pf-A",
      valueStream: "cross-cutting",
    });

    const scope = await resolveCoworkerBacklogScope("agent-a");

    expect(scope.occupationArmApplied).toBe(false);
    expect(scope.orClauses).toEqual([
      { agentId: "agent-a" },
      { claimedByAgentId: "agent-a" },
      { portfolioId: "pf-A" },
      { taxonomyNode: { portfolioId: "pf-A" } },
    ]);
  });

  it("degrades to owned/claimed only when the coworker has no portfolio or value stream", async () => {
    db.prisma.agent.findFirst.mockResolvedValue(null);

    const scope = await resolveCoworkerBacklogScope("agent-route-only");

    expect(scope.portfolioId).toBeNull();
    expect(scope.valueStream).toBeNull();
    expect(scope.occupationArmApplied).toBe(false);
    expect(scope.orClauses).toEqual([
      { agentId: "agent-route-only" },
      { claimedByAgentId: "agent-route-only" },
    ]);
  });
});
