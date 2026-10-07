// Awaiting acceptance on the workspace Backlog tile, distinct from Done
// (design 2026-09-24 acceptance accountability §3.5, AC-AA-05, BI-CEC60185).
//
// Merged-but-unproven work must never read as finished, so the tile shows the
// awaiting-acceptance count and its aged share beside Done instead of folding
// either into it. Kept out of command-center.ts, which is at its module-size
// ceiling.

import type { Prisma } from "@dpf/db";
import type { TileMetric, TileStatus } from "@/lib/workspace-home/types";
import {
  ACCEPTANCE_AGED_DAYS,
  agedAcceptanceShare,
  formatAgedCount,
  type AgedAcceptanceShare,
} from "@/lib/backlog/acceptance-sweep/aged-acceptance";
import { loadAgedAcceptanceItems } from "@/lib/backlog/acceptance-sweep/aged-acceptance-loader";

export type AcceptanceBacklogDb = Pick<Prisma.TransactionClient, "backlogItem" | "backlogItemActivity">;

/** Two bounded reads: the awaiting pool, then its entry activities. */
export async function loadAcceptanceBacklogShare(
  db: AcceptanceBacklogDb,
  now: Date,
): Promise<AgedAcceptanceShare> {
  const items = await db.backlogItem.findMany({
    where: { status: "awaiting-acceptance" },
    select: { id: true, status: true, createdAt: true },
  });
  const aged = await loadAgedAcceptanceItems(db, items, now);
  return agedAcceptanceShare(items, new Map(aged.map((item) => [item.id, item.ageBasis])));
}

/** The backlog tile with awaiting acceptance (and its aged share) placed before Done. */
export function withAcceptanceBacklogTile(
  tileStatus: Record<string, TileStatus>,
  share: AgedAcceptanceShare,
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

  const doneIndex = backlog.metrics.findIndex((metric) => metric.label === "Done");
  const at = doneIndex === -1 ? backlog.metrics.length : doneIndex;
  const metrics = [...backlog.metrics.slice(0, at), ...acceptanceRows, ...backlog.metrics.slice(at)];
  return { ...tileStatus, backlog: { ...backlog, metrics } };
}
