// Awaiting acceptance on the workspace Backlog tile, distinct from Done
// (design 2026-09-24 acceptance accountability §3.5, AC-AA-05, BI-CEC60185).
//
// Merged-but-unproven work must never read as finished, so the tile shows the
// awaiting-acceptance count and its aged share beside Done instead of folding
// either into it. Kept out of command-center.ts, which is at its module-size
// ceiling.
//
// BI-17C5F43A: a work-sync mirror is accepted only at its origin installation
// (BI-C5794F1D), so it is left out of this install's queue and shown as its own
// count. Otherwise a peer's whole queue reads here as local stalled work.

import type { Prisma } from "@dpf/db";
import { FEDERATED_WORK_ORIGIN_MARKER_SQL_PREFIX } from "@dpf/db/federated-work-contract";
import { ownedRowBodyWhere } from "@/lib/federation/federated-twins";
import type { TileMetric, TileStatus } from "@/lib/workspace-home/types";
import {
  ACCEPTANCE_AGED_DAYS,
  agedAcceptanceShare,
  formatAgedCount,
  type AgedAcceptanceShare,
} from "@/lib/backlog/acceptance-sweep/aged-acceptance";
import { loadAgedAcceptanceItems } from "@/lib/backlog/acceptance-sweep/aged-acceptance-loader";

export type AcceptanceBacklogDb = Pick<Prisma.TransactionClient, "backlogItem" | "backlogItemActivity">;

/** The local share, plus awaiting items whose acceptance belongs to a peer installation. */
export type AcceptanceBacklogShare = AgedAcceptanceShare & { peerOwned?: number };

/** Bounded reads: the locally owned awaiting pool, its entry activities, and the peer-owned count. */
export async function loadAcceptanceBacklogShare(
  db: AcceptanceBacklogDb,
  now: Date,
): Promise<AcceptanceBacklogShare> {
  const [items, peerOwned] = await Promise.all([
    db.backlogItem.findMany({
      where: { status: "awaiting-acceptance", AND: [ownedRowBodyWhere()] },
      select: { id: true, status: true, createdAt: true },
    }),
    db.backlogItem.count({
      where: { status: "awaiting-acceptance", body: { contains: FEDERATED_WORK_ORIGIN_MARKER_SQL_PREFIX } },
    }),
  ]);
  const aged = await loadAgedAcceptanceItems(db, items, now);
  return { ...agedAcceptanceShare(items, new Map(aged.map((item) => [item.id, item.ageBasis]))), peerOwned };
}

/** The backlog tile with awaiting acceptance (and its aged share) placed before Done. */
export function withAcceptanceBacklogTile(
  tileStatus: Record<string, TileStatus>,
  share: AcceptanceBacklogShare,
): Record<string, TileStatus> {
  const backlog = tileStatus.backlog;
  if (!backlog?.metrics) return tileStatus;

  const acceptanceRows: TileMetric[] = [
    { label: "Awaiting acceptance", value: share.awaiting, color: "var(--dpf-warning)" },
  ];
  if (share.awaiting > 0) {
    acceptanceRows.push({
      label: `Awaiting ${ACCEPTANCE_AGED_DAYS}+ days`,
      value: formatAgedCount(share),
      color: share.aged > 0 ? "var(--dpf-error)" : "var(--dpf-muted)",
    });
  }
  if ((share.peerOwned ?? 0) > 0) {
    acceptanceRows.push({ label: "Awaiting at peer installation", value: share.peerOwned!, color: "var(--dpf-muted)" });
  }

  const doneIndex = backlog.metrics.findIndex((metric) => metric.label === "Done");
  const at = doneIndex === -1 ? backlog.metrics.length : doneIndex;
  const metrics = [...backlog.metrics.slice(0, at), ...acceptanceRows, ...backlog.metrics.slice(at)];
  return { ...tileStatus, backlog: { ...backlog, metrics } };
}
