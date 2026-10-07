// Which awaiting-acceptance items are aged (design 2026-09-24 acceptance
// accountability §3.2 and §3.5, BI-CEC60185).
//
// One bounded read of entry activities for the given items, never one query
// per item. Age comes from acceptanceEnteredAt: the latest entry into the
// state, else creation marked `created`. `updatedAt` is never read.

import type { Prisma } from "@dpf/db";

import { acceptanceEnteredAt, type AcceptanceStateActivity } from "./acceptance-age";
import { acceptanceAgeDays } from "./acceptance-pool-age";
import { ACCEPTANCE_AGED_DAYS, type AgedAcceptanceItem } from "./aged-acceptance";

export type AgedAcceptanceDb = Pick<Prisma.TransactionClient, "backlogItemActivity">;

type AwaitingItem = { id: string; status: string; createdAt: Date };

/** The aged items among `items`; items not awaiting acceptance are ignored. */
export async function loadAgedAcceptanceItems(
  db: AgedAcceptanceDb,
  items: readonly AwaitingItem[],
  now: Date,
): Promise<AgedAcceptanceItem[]> {
  const awaiting = items.filter((item) => item.status === "awaiting-acceptance");
  if (awaiting.length === 0) return [];

  const rows = await db.backlogItemActivity.findMany({
    where: {
      backlogItemId: { in: awaiting.map((item) => item.id) },
      kind: "status_change",
      payload: { path: ["to"], equals: "awaiting-acceptance" },
    },
    select: { backlogItemId: true, kind: true, recordedAt: true, payload: true },
  });

  const activitiesByItem = new Map<string, AcceptanceStateActivity[]>();
  for (const row of rows) {
    const list = activitiesByItem.get(row.backlogItemId);
    if (list) list.push(row);
    else activitiesByItem.set(row.backlogItemId, [row]);
  }

  const aged: AgedAcceptanceItem[] = [];
  for (const item of awaiting) {
    const entry = acceptanceEnteredAt(activitiesByItem.get(item.id) ?? [], item.createdAt);
    if (acceptanceAgeDays(entry.enteredAt, now) >= ACCEPTANCE_AGED_DAYS) {
      aged.push({ id: item.id, ageBasis: entry.ageBasis });
    }
  }
  return aged;
}
