import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: {
    agent: { findFirst: vi.fn() },
    backlogItem: { findMany: vi.fn(), count: vi.fn() },
  },
}));
vi.mock("@dpf/db", () => db);

import { getCoworkerBacklogSlice } from "./surface-backlog";

const AGENT_ROW = { agentId: "agent-a", slugId: "agent-a", portfolioId: "pf-A", valueStream: "operate" };
const ITEM_ROW = {
  itemId: "BI-1",
  title: "Wire the ops cockpit",
  status: "open",
  type: "product",
  workType: "feature",
  priority: 2,
  effortSize: "medium",
  triageOutcome: null,
  updatedAt: new Date("2026-08-05T00:00:00.000Z"),
  scopeKind: "platform",
  archetypeCategories: [],
  archetypeIds: [],
  scopeRationale: null,
  lifecycleTags: [],
  epic: { epicId: "EP-X" },
};

beforeEach(() => vi.clearAllMocks());

describe("getCoworkerBacklogSlice", () => {
  it("returns the identity-scoped slice with a status roll-up", async () => {
    db.prisma.agent.findFirst.mockResolvedValue(AGENT_ROW);
    db.prisma.backlogItem.findMany.mockResolvedValue([ITEM_ROW]);
    db.prisma.backlogItem.count
      .mockResolvedValueOnce(9) // total
      .mockResolvedValueOnce(4) // open
      .mockResolvedValueOnce(3) // in-progress
      .mockResolvedValueOnce(2); // done

    const slice = await getCoworkerBacklogSlice("agent-a");

    expect(slice.scope.portfolioId).toBe("pf-A");
    expect(slice.scope.occupationArmApplied).toBe(true);
    expect(slice.summary).toEqual({ open: 4, inProgress: 3, done: 2 });
    expect(slice.total).toBe(9);
    expect(slice.truncated).toBe(true);
    expect(slice.items).toHaveLength(1);
    expect(slice.items[0]).toMatchObject({ itemId: "BI-1", epicId: "EP-X", workType: "feature" });
  });

  it("scopes the query by identity — no widening input exists", async () => {
    db.prisma.agent.findFirst.mockResolvedValue(AGENT_ROW);
    db.prisma.backlogItem.findMany.mockResolvedValue([]);
    db.prisma.backlogItem.count.mockResolvedValue(0);

    await getCoworkerBacklogSlice("agent-a", { status: "open", workType: "tool", limit: 9999 });

    const args = db.prisma.backlogItem.findMany.mock.calls[0][0] as {
      where: { OR: Record<string, unknown>[]; status?: string; workType?: string };
      take: number;
    };
    expect(args.where.status).toBe("open");
    expect(args.where.workType).toBe("tool");
    expect(args.take).toBe(200); // clamped
    const serialized = JSON.stringify(args.where.OR);
    expect(serialized).toContain("pf-A");
    expect(serialized).not.toContain("pf-B");
    expect(args.where.OR).toContainEqual({ agentId: "agent-a" });
  });

  it("drops an invalid status/workType rather than applying it", async () => {
    db.prisma.agent.findFirst.mockResolvedValue(AGENT_ROW);
    db.prisma.backlogItem.findMany.mockResolvedValue([]);
    db.prisma.backlogItem.count.mockResolvedValue(0);

    await getCoworkerBacklogSlice("agent-a", { status: "bogus", workType: "nope" });

    const where = db.prisma.backlogItem.findMany.mock.calls[0][0].where as Record<string, unknown>;
    expect(where.status).toBeUndefined();
    expect(where.workType).toBeUndefined();
  });

  it("degrades to area+owned when the coworker has no value stream", async () => {
    db.prisma.agent.findFirst.mockResolvedValue({ ...AGENT_ROW, valueStream: null });
    db.prisma.backlogItem.findMany.mockResolvedValue([]);
    db.prisma.backlogItem.count.mockResolvedValue(0);

    const slice = await getCoworkerBacklogSlice("agent-a");
    expect(slice.scope.occupationArmApplied).toBe(false);
  });
});
