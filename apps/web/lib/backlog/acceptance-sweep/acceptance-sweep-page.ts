import { ACCEPTANCE_OWED_ACTIVITY_KIND } from "./owed-snapshot";

export type AcceptanceSweepPageItem = {
  id: string; itemId: string; claimedByAgentId: string | null; agentId: string | null;
  status?: string;
  _count?: { activities: number };
  activities?: Array<{ kind: string; recordedAt: Date; payload: unknown }>;
};

/** Coarse indexed pool; the latest transition is checked after the bounded read. */
export const ACCEPTANCE_CANDIDATE_WHERE = {
  OR: [
    { status: "awaiting-acceptance" },
    { status: "done", activities: { some: { kind: "status_change",
      payload: { path: ["closureBasis"], equals: "canonical-deployment" } } } },
  ],
};

export function retainedDeploymentObligation(item: AcceptanceSweepPageItem): boolean {
  if (item.status !== "done") return false;
  const payload = item.activities?.find(row => row.kind === "status_change")?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const row = payload as Record<string, unknown>;
  // Unknown obligation values remain unresolved, not implicitly satisfied.
  return row.to === "done" && row.closureBasis === "canonical-deployment"
    && row.acceptanceObligation !== "satisfied";
}

const SELECT = {
  id: true, itemId: true, claimedByAgentId: true, agentId: true, status: true,
  _count: { select: { activities: { where: { kind: ACCEPTANCE_OWED_ACTIVITY_KIND } } } },
  activities: { where: { kind: "status_change" },
    orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
    select: { kind: true, recordedAt: true, payload: true }, take: 1 },
} as const;

export type AcceptanceSweepPageDb = {
  backlogItem: { findMany(args: {
    where: typeof ACCEPTANCE_CANDIDATE_WHERE & { id?: { gt: string } | { lte: string; notIn: string[] } };
    orderBy: { id: "asc" }[]; take: number; select: typeof SELECT;
  }): Promise<AcceptanceSweepPageItem[]> };
};
export type AcceptanceSweepPage = { items: AcceptanceSweepPageItem[]; unsnapshotted: number; nextCursor: string | null };

/**
 * One cursor covers fresh, revisited and retained candidates. Giving fresh work
 * unbounded priority starves old obligations under continuous arrivals. Advance
 * past filtered candidates too; a historical closure must not trap the cursor.
 */
export async function selectAcceptanceSweepPage(db: AcceptanceSweepPageDb, input: {
  pageSize: number; cursor: string | null;
}): Promise<AcceptanceSweepPage> {
  const take = Math.max(0, Math.floor(input.pageSize));
  if (!take) return { items: [], unsnapshotted: 0, nextCursor: input.cursor };
  const rows = await db.backlogItem.findMany({
    where: { ...ACCEPTANCE_CANDIDATE_WHERE, ...(input.cursor ? { id: { gt: input.cursor } } : {}) },
    orderBy: [{ id: "asc" }], take, select: SELECT,
  });
  if (input.cursor && rows.length < take) rows.push(...await db.backlogItem.findMany({
    where: { ...ACCEPTANCE_CANDIDATE_WHERE, id: { lte: input.cursor, notIn: rows.map(row => row.id) } },
    orderBy: [{ id: "asc" }], take: take - rows.length, select: SELECT,
  }));
  return {
    items: rows.filter(row => row.status === "awaiting-acceptance" || retainedDeploymentObligation(row)),
    unsnapshotted: rows.filter(row => row._count?.activities === 0
      && (row.status === "awaiting-acceptance" || retainedDeploymentObligation(row))).length,
    nextCursor: rows.at(-1)?.id ?? input.cursor,
  };
}
