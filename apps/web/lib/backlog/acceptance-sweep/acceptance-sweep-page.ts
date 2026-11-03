import { ownedRowBodyWhere } from "@/lib/federation/federated-twins";

import { ACCEPTANCE_OWED_ACTIVITY_KIND } from "./owed-snapshot";

/** The activity that records each step of a submitter question (submitter-confirmation.ts). */
export const SUBMITTER_CONFIRMATION_ACTIVITY_KIND = "submitter_confirmation";

export type AcceptanceSweepPageItem = {
  id: string; itemId: string; claimedByAgentId: string | null; agentId: string | null;
  status?: string;
  _count?: { activities: number };
  activities?: Array<{ kind: string; recordedAt: Date; payload: unknown }>;
};

/**
 * The obligations a done item can still carry (BI-C899BB40). Each concludes:
 * one question, one corrective item, or a recorded retirement. `not-owed` and
 * `satisfied` are never selected, and a resolved submitter_confirmation row
 * removes the item from the pool for good.
 */
export const RETAINED_ACCEPTANCE_OBLIGATIONS = [
  "pending-submitter-confirmation",
  "corrective-work-required",
  // Legacy: no longer written. Visited once to ask a customer its question or
  // to record the obligation retired, then excluded.
  "pending-independent-verification",
] as const;

/** Every acceptance obligation, whichever installation owns it. */
export const ACCEPTANCE_OBLIGATION_WHERE = {
  OR: [
    { status: "awaiting-acceptance" },
    { status: "done",
      activities: { some: { kind: "status_change",
        OR: RETAINED_ACCEPTANCE_OBLIGATIONS.map(value => ({ payload: { path: ["acceptanceObligation"], equals: value } })) } },
      NOT: { activities: { some: { kind: SUBMITTER_CONFIRMATION_ACTIVITY_KIND,
        payload: { path: ["resolved"], equals: true } } } } },
  ],
};

/**
 * Coarse indexed pool; the latest transition is checked after the bounded read.
 * BI-C5794F1D: a work-sync mirror is owned by its origin installation, which
 * alone accepts or closes it; a close made here is reverted by the next pull.
 * Mirrors are excluded with the same marker predicate the triage drain uses,
 * so they never use up the page or the close budget. The run counts them.
 */
export const ACCEPTANCE_CANDIDATE_WHERE = {
  ...ACCEPTANCE_OBLIGATION_WHERE,
  AND: [ownedRowBodyWhere()],
};

/** Whether the item's newest transition is a delivery closure that left a bounded obligation open. */
export function retainedClosureObligation(item: AcceptanceSweepPageItem): boolean {
  if (item.status !== "done") return false;
  const payload = item.activities?.find(row => row.kind === "status_change")?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const row = payload as Record<string, unknown>;
  return row.to === "done"
    && (row.closureBasis === "canonical-deployment" || row.closureBasis === "delivery-evidence")
    && (RETAINED_ACCEPTANCE_OBLIGATIONS as readonly unknown[]).includes(row.acceptanceObligation);
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
    items: rows.filter(row => row.status === "awaiting-acceptance" || retainedClosureObligation(row)),
    unsnapshotted: rows.filter(row => row._count?.activities === 0
      && (row.status === "awaiting-acceptance" || retainedClosureObligation(row))).length,
    nextCursor: rows.at(-1)?.id ?? input.cursor,
  };
}
