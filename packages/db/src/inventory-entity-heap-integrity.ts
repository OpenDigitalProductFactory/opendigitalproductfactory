export type InventoryEntityHeapIntegrityTx = {
  $executeRawUnsafe(query: string): Promise<number>;
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
};

export class InventoryEntityIntegrityError extends Error {
  readonly code = "INVENTORY_ENTITY_HEAP_INTEGRITY";

  constructor(message: string) {
    super(message);
    this.name = "InventoryEntityIntegrityError";
  }
}

export async function assertInventoryEntityHeapIntegrity(
  tx: InventoryEntityHeapIntegrityTx,
  entityKeys: readonly string[],
): Promise<void> {
  const distinctKeys = [...new Set(entityKeys)];
  if (distinctKeys.length === 0) return;

  await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
  await tx.$executeRawUnsafe("SET LOCAL enable_indexonlyscan = off");
  await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");

  const rows = await tx.$queryRawUnsafe<Array<{
    entityKey: string;
    heapCount: number;
  }>>(
    `
      SELECT
        requested."entityKey",
        (
          SELECT count(*)::int
          FROM "InventoryEntity" heap_row
          WHERE heap_row."entityKey" = requested."entityKey"
        ) AS "heapCount"
      FROM unnest($1::text[]) AS requested("entityKey")
      ORDER BY requested."entityKey"
    `,
    distinctKeys,
  );

  const countByKey = new Map(rows.map((row) => [row.entityKey, Number(row.heapCount)]));
  for (const entityKey of distinctKeys) {
    const heapCount = countByKey.get(entityKey) ?? 0;
    if (heapCount !== 1) {
      throw new InventoryEntityIntegrityError(
        `Inventory entity "${entityKey}" failed the heap integrity check: `
          + `expected 1 row, found ${heapCount}. Discovery was rolled back before `
          + "dependent evidence was published.",
      );
    }
  }
}
