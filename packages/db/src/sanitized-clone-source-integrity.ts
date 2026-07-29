// @ts-expect-error -- importable runtime guard is plain .mjs by design
import { checkIndexIntegrity } from "../scripts/index-integrity-core.mjs";

type RawQueryClient = {
  $queryRawUnsafe<T>(query: string, ...values: unknown[]): Promise<T>;
};

type SourceIndexContract = {
  table: string;
  requiredIndexes: ReadonlyArray<{ name: string; unique: boolean }>;
};

type SourceIntegrityOptions = {
  schema?: string;
};

export const SANITIZED_CLONE_SOURCE_INDEX_CONTRACTS: ReadonlyArray<SourceIndexContract> =
  Object.freeze([
    {
      table: "InventoryEntity",
      requiredIndexes: [
        { name: "InventoryEntity_entityKey_key", unique: true },
      ],
    },
    {
      table: "PlatformIssueReport",
      requiredIndexes: [
        { name: "PlatformIssueReport_dedupeKey_open_key", unique: true },
      ],
    },
  ]);

async function assertIndexContract(
  source: RawQueryClient,
  contract: SourceIndexContract,
  schema: string,
): Promise<void> {
  const queryClient = {
    query: async (sql: string, params: unknown[] = []) => ({
      rows: await source.$queryRawUnsafe<unknown[]>(sql, ...params),
    }),
  };
  const report = await checkIndexIntegrity(queryClient, {
    amcheckMode: "require",
    schema,
    table: contract.table,
    uniqueOnly: false,
    requiredIndexes: contract.requiredIndexes,
  });
  if (!report.failed) return;

  const details = report.corrupted
    .map((row: { index: string; error: string }) => `${row.index}: ${row.error}`)
    .join("; ");
  throw new Error(
    `Production ${contract.table} source failed index/heap integrity; preview was not published. ${details}`,
  );
}

async function assertPlatformIssueReportDedupeSemantics(
  source: RawQueryClient,
  schema: string,
): Promise<void> {
  const quotedSchema = `"${schema.replaceAll('"', '""')}"`;
  const rows = await source.$queryRawUnsafe<Array<{ duplicateGroups: number }>>(`
    SELECT count(*)::integer AS "duplicateGroups"
    FROM (
      SELECT report."dedupeKey"
      FROM ${quotedSchema}."PlatformIssueReport"
        TABLESAMPLE SYSTEM (100) AS report
      WHERE report."dedupeKey" IS NOT NULL
        AND report.status NOT IN (
          'resolved_locally',
          'resolved_upstream',
          'suppressed'
        )
      GROUP BY report."dedupeKey"
      HAVING count(*) > 1
    ) duplicate_groups
  `);
  const duplicateGroups = Number(rows[0]?.duplicateGroups ?? 0);
  if (duplicateGroups === 0) return;

  throw new Error(
    "Production PlatformIssueReport source failed heap dedupe integrity for " +
      "PlatformIssueReport_dedupeKey_open_key; preview was not published. " +
      `${duplicateGroups} active dedupeKey group(s) contain duplicates.`,
  );
}

export async function assertSanitizedCloneSourceIntegrity(
  source: RawQueryClient,
  options: SourceIntegrityOptions = {},
): Promise<void> {
  const schema = options.schema ?? "public";
  for (const contract of SANITIZED_CLONE_SOURCE_INDEX_CONTRACTS) {
    await assertIndexContract(source, contract, schema);
  }
  await assertPlatformIssueReportDedupeSemantics(source, schema);
}
