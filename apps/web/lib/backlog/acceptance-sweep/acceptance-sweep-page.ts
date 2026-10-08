import type { BacklogStatus } from "@/lib/backlog/transitions";

import { ACCEPTANCE_OWED_ACTIVITY_KIND } from "./owed-snapshot";

// Which awaiting-acceptance items one sweep run evaluates (BI-DF255666, AC-S2-2).
// Design: docs/superpowers/specs/2026-09-24-acceptance-accountability-design.md §3.3 step 1.
//
// Items with no acceptance_owed snapshot come first, so a newly entered item is
// seen on the next run. The rest of the page revisits snapshotted items.
//
// The design orders that second tier by "oldest snapshot". S1 writes a snapshot
// only when the answer changed, so an unchanged item's snapshot never gets
// newer, and ordering by it would re-select the same oldest page every day and
// never reach the rest of the pool. The second tier is therefore a round-robin
// by row id from a cursor the previous run recorded, which gives the design's
// stated property: the whole pool is revisited every ceil(N / page) runs.

const AWAITING_ACCEPTANCE: BacklogStatus = "awaiting-acceptance";

export type AcceptanceSweepPageItem = {
  id: string;
  itemId: string;
  claimedByAgentId: string | null;
  agentId: string | null;
};

type ActivityFilter =
  | { none: { kind: typeof ACCEPTANCE_OWED_ACTIVITY_KIND } }
  | { some: { kind: typeof ACCEPTANCE_OWED_ACTIVITY_KIND } };

export type AcceptanceSweepPageDb = {
  backlogItem: {
    findMany(args: {
      where: {
        status: BacklogStatus;
        activities: ActivityFilter;
        id?: { gt: string } | { lte: string; notIn: string[] };
      };
      orderBy: Array<{ createdAt: "asc" } | { id: "asc" }>;
      take: number;
      select: { id: true; itemId: true; claimedByAgentId: true; agentId: true };
    }): Promise<AcceptanceSweepPageItem[]>;
  };
};

export type AcceptanceSweepPage = {
  items: AcceptanceSweepPageItem[];
  /** How many of the page had never been snapshotted. */
  unsnapshotted: number;
  /** The last snapshotted item visited; the next run continues after it. */
  nextCursor: string | null;
};

const SELECT = { id: true, itemId: true, claimedByAgentId: true, agentId: true } as const;
const SNAPSHOTTED: ActivityFilter = { some: { kind: ACCEPTANCE_OWED_ACTIVITY_KIND } };

export async function selectAcceptanceSweepPage(
  db: AcceptanceSweepPageDb,
  input: { pageSize: number; cursor: string | null },
): Promise<AcceptanceSweepPage> {
  const pageSize = Math.max(0, Math.floor(input.pageSize));
  if (pageSize === 0) return { items: [], unsnapshotted: 0, nextCursor: input.cursor };

  const fresh = await db.backlogItem.findMany({
    where: { status: AWAITING_ACCEPTANCE, activities: { none: { kind: ACCEPTANCE_OWED_ACTIVITY_KIND } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: pageSize,
    select: SELECT,
  });

  const revisit: AcceptanceSweepPageItem[] = [];
  let remaining = pageSize - fresh.length;
  if (remaining > 0) {
    const after = await db.backlogItem.findMany({
      where: { status: AWAITING_ACCEPTANCE, activities: SNAPSHOTTED, ...(input.cursor ? { id: { gt: input.cursor } } : {}) },
      orderBy: [{ id: "asc" }],
      take: remaining,
      select: SELECT,
    });
    revisit.push(...after);
    remaining -= after.length;
    if (remaining > 0 && input.cursor) {
      // Wrap to the start of the pool, never past where this page began.
      const wrapped = await db.backlogItem.findMany({
        where: {
          status: AWAITING_ACCEPTANCE,
          activities: SNAPSHOTTED,
          id: { lte: input.cursor, notIn: after.map((item) => item.id) },
        },
        orderBy: [{ id: "asc" }],
        take: remaining,
        select: SELECT,
      });
      revisit.push(...wrapped);
    }
  }

  return {
    items: [...fresh, ...revisit],
    unsnapshotted: fresh.length,
    nextCursor: revisit.length > 0 ? revisit[revisit.length - 1]!.id : input.cursor,
  };
}
