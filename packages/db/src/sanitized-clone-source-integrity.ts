// @ts-expect-error -- importable runtime guard is plain .mjs by design
import { checkIndexIntegrity } from "../scripts/index-integrity-core.mjs";

type RawQueryClient = {
  $queryRawUnsafe<T>(query: string, ...values: never[]): Promise<T>;
};

export async function assertSourceInventoryIntegrity(
  source: RawQueryClient,
): Promise<void> {
  const queryClient = {
    query: async (sql: string, params: unknown[] = []) => ({
      rows: await source.$queryRawUnsafe<unknown[]>(
        sql,
        ...(params as never[]),
      ),
    }),
  };
  const report = await checkIndexIntegrity(queryClient, {
    amcheckMode: "require",
    schema: "public",
    table: "InventoryEntity",
    uniqueOnly: false,
    requiredIndexes: [{ name: "InventoryEntity_entityKey_key", unique: true }],
  });
  if (!report.failed) return;

  const details = report.corrupted
    .map((row: { index: string; error: string }) => `${row.index}: ${row.error}`)
    .join("; ");
  throw new Error(
    `Production InventoryEntity source failed index/heap integrity; preview was not published. ${details}`,
  );
}
