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

export async function lockInventoryEntityKeys(
  tx: InventoryEntityHeapIntegrityTx,
  entityKeys: readonly string[],
): Promise<void> {
  const distinctKeys = [...new Set(entityKeys)].sort();
  if (distinctKeys.length === 0) return;

  await tx.$queryRawUnsafe(
    `
      WITH acquired AS MATERIALIZED (
        SELECT
          locked."entityKey",
          pg_advisory_xact_lock(
            hashtextextended(locked."entityKey", 0)
          ) AS advisory_lock
        FROM (
          SELECT unnest($1::text[]) AS "entityKey"
          ORDER BY 1
        ) locked
      )
      SELECT acquired."entityKey"
      FROM acquired
      ORDER BY acquired."entityKey"
    `,
    distinctKeys,
  );
}

export async function assertInventoryEntityHeapIntegrity(
  tx: InventoryEntityHeapIntegrityTx,
  entityKeys: readonly string[],
): Promise<void> {
  const distinctKeys = [...new Set(entityKeys)].sort();
  if (distinctKeys.length === 0) return;

  const settings = (await tx.$queryRawUnsafe<Array<{
    enableIndexscan: string;
    enableIndexonlyscan: string;
    enableBitmapscan: string;
  }>>(
    `
      SELECT
        current_setting('enable_indexscan') AS "enableIndexscan",
        current_setting('enable_indexonlyscan') AS "enableIndexonlyscan",
        current_setting('enable_bitmapscan') AS "enableBitmapscan"
    `,
  ))[0];
  if (!settings) {
    throw new InventoryEntityIntegrityError(
      "Inventory entity heap integrity could not read PostgreSQL planner settings",
    );
  }
  const plannerValue = (value: string): "on" | "off" => {
    if (value === "on" || value === "off") return value;
    throw new InventoryEntityIntegrityError(
      `Unexpected PostgreSQL planner setting value: ${value}`,
    );
  };

  let rows: Array<{
    entityKey: string;
    heapCount: number;
  }> = [];
  let integrityQueryError: unknown;
  try {
    await tx.$executeRawUnsafe("SET LOCAL enable_indexscan = off");
    await tx.$executeRawUnsafe("SET LOCAL enable_indexonlyscan = off");
    await tx.$executeRawUnsafe("SET LOCAL enable_bitmapscan = off");
    rows = await tx.$queryRawUnsafe(
      `
        WITH requested AS (
          SELECT unnest($1::text[]) AS "entityKey"
        ),
        heap_rows AS MATERIALIZED (
          SELECT id, "entityKey"
          FROM "InventoryEntity"
        )
        SELECT
          requested."entityKey",
          count(heap_rows.id)::int AS "heapCount"
        FROM requested
        LEFT JOIN heap_rows
          ON heap_rows."entityKey" = requested."entityKey"
        GROUP BY requested."entityKey"
        ORDER BY requested."entityKey"
      `,
      distinctKeys,
    );
  } catch (error) {
    integrityQueryError = error;
  }

  try {
    await tx.$executeRawUnsafe(
      `SET LOCAL enable_indexscan = ${plannerValue(settings.enableIndexscan)}`,
    );
    await tx.$executeRawUnsafe(
      `SET LOCAL enable_indexonlyscan = ${plannerValue(settings.enableIndexonlyscan)}`,
    );
    await tx.$executeRawUnsafe(
      `SET LOCAL enable_bitmapscan = ${plannerValue(settings.enableBitmapscan)}`,
    );
  } catch (restoreError) {
    if (integrityQueryError) {
      throw new AggregateError(
        [integrityQueryError, restoreError],
        "Inventory heap check failed and PostgreSQL planner settings could not be restored",
      );
    }
    throw restoreError;
  }
  if (integrityQueryError) throw integrityQueryError;

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
