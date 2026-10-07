import { describe, expect, it } from "vitest";

import { selectAcceptanceSweepPage, type AcceptanceSweepPageDb } from "./acceptance-sweep-page";

// AC-S2-2 (BI-DF255666; design §3.3 step 1): one run pages at most the
// configured size, unsnapshotted items first. Snapshotted items are revisited
// round-robin by a cursor the previous run recorded, so the whole pool is seen
// every ceil(N / page) runs even though an unchanged item's snapshot is never
// rewritten (S1 writes only on change).

type Row = { id: string; itemId: string; createdAt: Date; snapshotted: boolean; claimedByAgentId: string | null; agentId: string | null };

function row(id: string, snapshotted: boolean, createdDay = 1): Row {
  return { id, itemId: `BI-${id}`, createdAt: new Date(Date.UTC(2026, 6, createdDay)), snapshotted, claimedByAgentId: null, agentId: null };
}

/** Evaluates the exact where/orderBy/take shapes the selector sends. */
function fakeDb(rows: Row[]): AcceptanceSweepPageDb & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    backlogItem: {
      findMany: async (args) => {
        calls.push(args);
        const { where, take } = args;
        let out = rows.filter((entry) => where.status === "awaiting-acceptance");
        if ("none" in where.activities) out = out.filter((entry) => !entry.snapshotted);
        if ("some" in where.activities) out = out.filter((entry) => entry.snapshotted);
        if (where.id && "gt" in where.id) out = out.filter((entry) => entry.id > (where.id as { gt: string }).gt);
        if (where.id && "lte" in where.id) {
          const { lte, notIn } = where.id;
          out = out.filter((entry) => entry.id <= lte && !notIn.includes(entry.id));
        }
        out = [...out].sort((a, b) => ("createdAt" in args.orderBy[0]!
          ? a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
          : a.id.localeCompare(b.id)));
        return out.slice(0, take).map(({ snapshotted: _s, createdAt: _c, ...rest }) => rest);
      },
    },
  };
}

describe("selectAcceptanceSweepPage", () => {
  it("takes unsnapshotted items first, oldest created first, up to the page size", async () => {
    const db = fakeDb([row("a", true), row("b", false, 9), row("c", false, 2), row("d", true)]);
    const page = await selectAcceptanceSweepPage(db, { pageSize: 2, cursor: null });
    expect(page.items.map((item) => item.itemId)).toEqual(["BI-c", "BI-b"]);
    expect(page.unsnapshotted).toBe(2);
    // No snapshotted item was visited, so the cursor does not move.
    expect(page.nextCursor).toBeNull();
  });

  it("fills the rest of the page from snapshotted items after the cursor", async () => {
    const db = fakeDb([row("a", true), row("b", true), row("c", true), row("d", false)]);
    const page = await selectAcceptanceSweepPage(db, { pageSize: 3, cursor: "a" });
    expect(page.items.map((item) => item.itemId)).toEqual(["BI-d", "BI-b", "BI-c"]);
    expect(page.nextCursor).toBe("c");
  });

  it("wraps around so every snapshotted item is revisited", async () => {
    const db = fakeDb([row("a", true), row("b", true), row("c", true), row("d", true)]);
    const first = await selectAcceptanceSweepPage(db, { pageSize: 3, cursor: "c" });
    expect(first.items.map((item) => item.itemId)).toEqual(["BI-d", "BI-a", "BI-b"]);
    expect(first.nextCursor).toBe("b");
    const second = await selectAcceptanceSweepPage(db, { pageSize: 3, cursor: first.nextCursor });
    expect(second.items.map((item) => item.itemId)).toEqual(["BI-c", "BI-d", "BI-a"]);
  });

  it("never selects an item twice when the pool is smaller than the page", async () => {
    const db = fakeDb([row("a", true), row("b", true)]);
    const page = await selectAcceptanceSweepPage(db, { pageSize: 10, cursor: "a" });
    expect(page.items.map((item) => item.itemId)).toEqual(["BI-b", "BI-a"]);
  });

  it("asks only for awaiting-acceptance items and bounds every read by the page", async () => {
    const db = fakeDb([row("a", false)]);
    await selectAcceptanceSweepPage(db, { pageSize: 5, cursor: null });
    for (const call of db.calls as Array<{ where: { status: string }; take: number }>) {
      expect(call.where.status).toBe("awaiting-acceptance");
      expect(call.take).toBeLessThanOrEqual(5);
    }
    expect(JSON.stringify(db.calls)).not.toContain("updatedAt");
  });

  it("returns nothing for a zero page", async () => {
    const db = fakeDb([row("a", false)]);
    const page = await selectAcceptanceSweepPage(db, { pageSize: 0, cursor: "x" });
    expect(page).toEqual({ items: [], unsnapshotted: 0, nextCursor: "x" });
  });
});
