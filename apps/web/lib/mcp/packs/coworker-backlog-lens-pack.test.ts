import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: {
    agent: { findFirst: vi.fn() },
    backlogItem: { findMany: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("@dpf/db", () => db);

import { coworkerBacklogLensPack } from "./coworker-backlog-lens-pack";
import { TOOL_TO_GRANTS, isToolAllowedByGrants } from "@/lib/tak/agent-grants";

const AGENT_ROW = {
  agentId: "agent-a",
  slugId: "agent-a",
  portfolioId: "pf-A",
  valueStream: "operate",
};

const ITEM_ROW = {
  itemId: "BI-1",
  title: "Wire the ops cockpit",
  status: "open",
  type: "product",
  workType: "feature",
  priority: 2,
  effortSize: "medium",
  updatedAt: new Date("2026-08-05T00:00:00.000Z"),
  triageOutcome: null,
  scopeKind: "platform",
  archetypeCategories: [],
  archetypeIds: [],
  scopeRationale: null,
  lifecycleTags: [],
  epic: { epicId: "EP-X" },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("coworker-backlog-lens pack — registration", () => {
  it("exposes exactly list_my_backlog", () => {
    expect(coworkerBacklogLensPack.definitions.map((d) => d.name)).toEqual(["list_my_backlog"]);
    expect(Object.keys(coworkerBacklogLensPack.handlers)).toEqual(["list_my_backlog"]);
  });

  it("is a read-only, non-side-effecting view", () => {
    const def = coworkerBacklogLensPack.definitions[0];
    expect(def.requiredCapability).toBe("view_platform");
    expect(def.sideEffect).toBe(false);
    expect(def.annotations?.readOnlyHint).toBe(true);
  });

  it("description is provenance-free (no BI/Phase/EP/path leakage)", () => {
    for (const d of coworkerBacklogLensPack.definitions) {
      expect(d.description).not.toMatch(/\bBI-|Phase \d|EP-|apps\/web\//);
    }
  });

  it("grant mirrors agent-grants and is satisfied by backlog_read", () => {
    expect(coworkerBacklogLensPack.grants.list_my_backlog).toEqual(["backlog_read"]);
    expect(TOOL_TO_GRANTS.list_my_backlog).toEqual(["backlog_read"]);
    expect(isToolAllowedByGrants("list_my_backlog", ["backlog_read"])).toBe(true);
  });
});

describe("coworker-backlog-lens pack — handler behavior", () => {
  it("requires a current coworker agentId", async () => {
    await expect(
      coworkerBacklogLensPack.handlers.list_my_backlog({}, "u1", {}),
    ).rejects.toThrow(/current coworker agentId is required/);
  });

  it("returns the identity-scoped slice with a status roll-up", async () => {
    db.prisma.agent.findFirst.mockResolvedValue(AGENT_ROW);
    db.prisma.backlogItem.findMany.mockResolvedValue([ITEM_ROW]);
    // Promise.all order: count(matching), count(open), count(in-progress), count(done)
    db.prisma.backlogItem.count
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);

    const res = await coworkerBacklogLensPack.handlers.list_my_backlog(
      {},
      "u1",
      { agentId: "agent-a", routeContext: "/ops" },
    );

    expect(res.success).toBe(true);
    expect(res.message).toBe(
      "Your backlog: 4 open, 3 in-progress, 2 done. Showing 1 of 9 in-scope item(s).",
    );
    const data = res.data as {
      scope: { portfolioId: string; occupationArmApplied: boolean; professionKey: string | null };
      summary: { open: number; inProgress: number; done: number };
      total: number;
      items: { itemId: string; epicId: string | null }[];
    };
    expect(data.scope.portfolioId).toBe("pf-A");
    expect(data.scope.occupationArmApplied).toBe(true);
    expect(data.summary).toEqual({ open: 4, inProgress: 3, done: 2 });
    expect(data.total).toBe(9);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].itemId).toBe("BI-1");
    expect(data.items[0].epicId).toBe("EP-X");
  });

  it("scopes the query by identity only — a caller-supplied portfolioId cannot widen it", async () => {
    db.prisma.agent.findFirst.mockResolvedValue(AGENT_ROW);
    db.prisma.backlogItem.findMany.mockResolvedValue([]);
    db.prisma.backlogItem.count.mockResolvedValue(0);

    await coworkerBacklogLensPack.handlers.list_my_backlog(
      // Attacker-style params: a foreign portfolioId and an OR override must be ignored.
      { portfolioId: "pf-B", OR: [{ portfolioId: "pf-B" }], status: "open" },
      "u1",
      { agentId: "agent-a" },
    );

    const where = db.prisma.backlogItem.findMany.mock.calls[0][0].where as {
      OR: Record<string, unknown>[];
      status?: string;
      portfolioId?: string;
    };
    // Only the identity-derived OR clauses + the status narrowing survive.
    expect(where.status).toBe("open");
    expect(where.portfolioId).toBeUndefined();
    const serialized = JSON.stringify(where.OR);
    expect(serialized).not.toContain("pf-B");
    expect(serialized).toContain("pf-A");
    expect(where.OR).toContainEqual({ agentId: "agent-a" });
  });

  it("forwards status/workType narrowing and clamps the limit", async () => {
    db.prisma.agent.findFirst.mockResolvedValue(AGENT_ROW);
    db.prisma.backlogItem.findMany.mockResolvedValue([]);
    db.prisma.backlogItem.count.mockResolvedValue(0);

    await coworkerBacklogLensPack.handlers.list_my_backlog(
      { status: "open", workType: "tool", limit: 9999 },
      "u1",
      { agentId: "agent-a" },
    );

    const args = db.prisma.backlogItem.findMany.mock.calls[0][0] as {
      where: { status?: string; workType?: string };
      take: number;
    };
    expect(args.where.status).toBe("open");
    expect(args.where.workType).toBe("tool");
    expect(args.take).toBe(200); // clamped from 9999
  });
});
