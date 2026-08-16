import { Prisma, prisma } from "@dpf/db";

import type { InitiativeGateKey } from "./receipt-schema";

export type InitiativeGateActivityRow = {
  id: string;
  backlogItemId: string;
  gateKey: InitiativeGateKey;
  recordedAt: Date;
  payload: unknown;
};

export function selectLatestInitiativeGateRows(
  rows: InitiativeGateActivityRow[],
  itemIds: readonly string[],
): InitiativeGateActivityRow[] {
  const requested = new Set(itemIds);
  const ordered = rows
    .filter((row) => requested.has(row.backlogItemId) && row.gateKey)
    .sort((left, right) => left.backlogItemId.localeCompare(right.backlogItemId)
      || left.gateKey.localeCompare(right.gateKey)
      || right.recordedAt.getTime() - left.recordedAt.getTime()
      || right.id.localeCompare(left.id));
  const seen = new Set<string>();
  return ordered.filter((row) => {
    const key = `${row.backlogItemId}\0${row.gateKey}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type InitiativeGateQueryDb = {
  $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
};

export async function readLatestInitiativeGateRows(
  itemIds: readonly string[],
  db: InitiativeGateQueryDb = prisma,
): Promise<InitiativeGateActivityRow[]> {
  if (itemIds.length === 0) return [];
  return db.$queryRaw<InitiativeGateActivityRow[]>(Prisma.sql`
    SELECT DISTINCT ON ("backlogItemId", "gateKey")
      "id", "backlogItemId", "gateKey", "recordedAt", "payload"
    FROM "BacklogItemActivity"
    WHERE "backlogItemId" IN (${Prisma.join(itemIds)})
      AND "kind" = 'initiative_gate_receipt'
      AND "gateKey" IS NOT NULL
    ORDER BY "backlogItemId", "gateKey", "recordedAt" DESC, "id" DESC
  `);
}
