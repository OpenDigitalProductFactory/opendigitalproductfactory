import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `platform_issue_report_repair_${randomUUID().replaceAll("-", "")}`;
let client: Client;

const migrationUrl = new URL(
  "../prisma/migrations/20260729143000_repair_platform_issue_report_index_integrity/migration.sql",
  import.meta.url,
);

async function scalar(sql: string): Promise<number> {
  const result = await client.query<{ value: string }>(sql);
  return Number(result.rows[0]?.value ?? 0);
}

async function readRows(): Promise<unknown[]> {
  return (await client.query(`
    SELECT
      id, "reportId", type, severity, status, title, description, "errorStack",
      source, "dedupeKey", "occurrenceCount", "firstSeenAt", "lastSeenAt",
      "stagedUntilPromoted", "digitalProductId", "portfolioId", "agentId",
      "featureBuildId", "triggerKind", "supportSessionId", "upstreamIssueNumber",
      "mergedIntoId", "suppressionReason", "createdAt"
    FROM "PlatformIssueReport"
    ORDER BY id
  `)).rows;
}

describeDatabase("PlatformIssueReport partial-unique integrity migration", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query(`
      CREATE TABLE "PlatformIssueReport" (
        id TEXT PRIMARY KEY,
        "reportId" TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'medium',
        status TEXT NOT NULL DEFAULT 'open',
        title TEXT NOT NULL,
        description TEXT,
        "errorStack" TEXT,
        "digitalProductId" TEXT,
        "portfolioId" TEXT,
        "agentId" TEXT,
        "featureBuildId" TEXT,
        "triggerKind" TEXT,
        "supportSessionId" TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        "dedupeKey" TEXT,
        "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
        "firstSeenAt" TIMESTAMPTZ,
        "lastSeenAt" TIMESTAMPTZ,
        "stagedUntilPromoted" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" TIMESTAMPTZ NOT NULL,
        "updatedAt" TIMESTAMPTZ NOT NULL,
        "upstreamIssueNumber" INTEGER
      );
      CREATE INDEX "PlatformIssueReport_dedupeKey_idx"
        ON "PlatformIssueReport" ("dedupeKey");
      CREATE INDEX "PlatformIssueReport_dedupeKey_open_key"
        ON "PlatformIssueReport" ("dedupeKey")
        WHERE "dedupeKey" IS NOT NULL
          AND "status" NOT IN ('resolved_locally', 'resolved_upstream', 'suppressed');

      INSERT INTO "PlatformIssueReport" (
        id, "reportId", type, severity, status, title, description, "errorStack",
        "digitalProductId", "portfolioId", "agentId", "featureBuildId",
        "triggerKind", "supportSessionId", source, "dedupeKey",
        "occurrenceCount", "firstSeenAt", "lastSeenAt", "stagedUntilPromoted",
        "createdAt", "updatedAt", "upstreamIssueNumber"
      ) VALUES
        (
          'compatible-old', 'PIR-COMPATIBLE-OLD', 'runtime', 'low', 'open',
          'old payload', 'old description', 'old stack',
          'product-1', 'portfolio-1', 'agent-1', 'build-1',
          'log-signature', 'support-1', 'automated', 'log-sig:sandbox:compatible',
          2, NULL, '2026-07-10', true,
          '2026-07-01', '2026-07-10', 42
        ),
        (
          'compatible-mid', 'PIR-COMPATIBLE-MID', 'runtime', 'critical', 'open',
          'mid payload', 'mid description', 'mid stack',
          'product-1', 'portfolio-1', 'agent-1', 'build-1',
          'log-signature', 'support-1', 'automated', 'log-sig:sandbox:compatible',
          5, '2026-06-20', NULL, false,
          '2026-07-15', '2026-07-15', 42
        ),
        (
          'compatible-new', 'PIR-COMPATIBLE-NEW', 'runtime', 'high', 'open',
          'new payload', 'new description', 'new stack',
          'product-1', 'portfolio-1', 'agent-1', 'build-1',
          'log-signature', 'support-1', 'automated', 'log-sig:sandbox:compatible',
          11, '2026-07-20', '2026-07-25', true,
          '2026-07-20', '2026-07-25', 42
        ),
        (
          'incompatible-old', 'PIR-INCOMPATIBLE-OLD', 'runtime', 'medium', 'open',
          'incompatible old', 'preserve incompatible old', 'incompatible old stack',
          'product-2', 'portfolio-2', 'agent-2', NULL,
          'log-signature', NULL, 'automated', 'log-sig:sandbox:incompatible',
          7, '2026-07-01', '2026-07-02', false,
          '2026-07-01', '2026-07-02', NULL
        ),
        (
          'incompatible-new', 'PIR-INCOMPATIBLE-NEW', 'runtime', 'high', 'open',
          'incompatible new', 'preserve incompatible new', 'incompatible new stack',
          'product-2', 'portfolio-OTHER', 'agent-2', NULL,
          'log-signature', NULL, 'automated', 'log-sig:sandbox:incompatible',
          13, '2026-07-20', '2026-07-21', true,
          '2026-07-20', '2026-07-21', NULL
        ),
        (
          'overflow-old', 'PIR-OVERFLOW-OLD', 'runtime', 'medium', 'open',
          'overflow old', 'preserve overflow old', 'overflow old stack',
          NULL, NULL, NULL, NULL, 'log-signature', NULL,
          'automated', 'log-sig:sandbox:overflow',
          2147483647, '2026-07-01', '2026-07-02', false,
          '2026-07-01', '2026-07-02', NULL
        ),
        (
          'overflow-new', 'PIR-OVERFLOW-NEW', 'runtime', 'medium', 'open',
          'overflow new', 'preserve overflow new', 'overflow new stack',
          NULL, NULL, NULL, NULL, 'log-signature', NULL,
          'automated', 'log-sig:sandbox:overflow',
          1, '2026-07-20', '2026-07-21', false,
          '2026-07-20', '2026-07-21', NULL
        ),
        (
          'underflow-old', 'PIR-UNDERFLOW-OLD', 'runtime', 'medium', 'open',
          'underflow old', 'preserve underflow old', 'underflow old stack',
          NULL, NULL, NULL, NULL, 'log-signature', NULL,
          'automated', 'log-sig:sandbox:underflow',
          -2147483648, '2026-07-01', '2026-07-02', false,
          '2026-07-01', '2026-07-02', NULL
        ),
        (
          'underflow-new', 'PIR-UNDERFLOW-NEW', 'runtime', 'medium', 'open',
          'underflow new', 'preserve underflow new', 'underflow new stack',
          NULL, NULL, NULL, NULL, 'log-signature', NULL,
          'automated', 'log-sig:sandbox:underflow',
          -1, '2026-07-20', '2026-07-21', false,
          '2026-07-20', '2026-07-21', NULL
        ),
        (
          'resolved-old', 'PIR-RESOLVED-OLD', 'runtime', 'low', 'resolved_locally',
          'resolved old', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
          'automated', 'log-sig:sandbox:terminal', 1, NULL, NULL, false,
          '2026-07-01', '2026-07-01', NULL
        ),
        (
          'resolved-new', 'PIR-RESOLVED-NEW', 'runtime', 'low', 'suppressed',
          'resolved new', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
          'automated', 'log-sig:sandbox:terminal', 1, NULL, NULL, false,
          '2026-07-02', '2026-07-02', NULL
        );
    `);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("retains evidence, repairs active duplicates, and restores exact indexes", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    await client.query(migration);

    expect(await scalar(`SELECT count(*)::text value FROM "PlatformIssueReport"`)).toBe(11);
    expect(await scalar(`
      SELECT count(*)::text value
      FROM (
        SELECT "dedupeKey"
        FROM "PlatformIssueReport"
        WHERE "dedupeKey" IS NOT NULL
          AND status NOT IN ('resolved_locally', 'resolved_upstream', 'suppressed')
        GROUP BY "dedupeKey"
        HAVING count(*) > 1
      ) duplicates
    `)).toBe(0);

    const compatible = (await client.query(`
      SELECT id, severity, status, title, description, "errorStack",
             "occurrenceCount", "firstSeenAt", "lastSeenAt",
             "stagedUntilPromoted", "mergedIntoId", "suppressionReason"
      FROM "PlatformIssueReport"
      WHERE id IN ('compatible-old', 'compatible-mid', 'compatible-new')
      ORDER BY id
    `)).rows;
    expect(compatible).toMatchObject([
      {
        id: "compatible-mid",
        status: "suppressed",
        title: "mid payload",
        description: "mid description",
        errorStack: "mid stack",
        occurrenceCount: 5,
        mergedIntoId: "compatible-new",
        suppressionReason: "index-repair-duplicate",
      },
      {
        id: "compatible-new",
        severity: "critical",
        status: "open",
        title: "new payload",
        occurrenceCount: 18,
        stagedUntilPromoted: false,
        mergedIntoId: null,
        suppressionReason: null,
      },
      {
        id: "compatible-old",
        status: "suppressed",
        title: "old payload",
        description: "old description",
        errorStack: "old stack",
        occurrenceCount: 2,
        mergedIntoId: "compatible-new",
        suppressionReason: "index-repair-duplicate",
      },
    ]);
    expect(new Date(compatible[1]?.firstSeenAt).toISOString())
      .toBe("2026-06-20T00:00:00.000Z");
    expect(new Date(compatible[1]?.lastSeenAt).toISOString())
      .toBe("2026-07-25T00:00:00.000Z");

    const incompatible = (await client.query(`
      SELECT id, status, description, "occurrenceCount", "portfolioId",
             "mergedIntoId", "suppressionReason"
      FROM "PlatformIssueReport"
      WHERE id IN ('incompatible-old', 'incompatible-new')
      ORDER BY id
    `)).rows;
    expect(incompatible).toEqual([
      {
        id: "incompatible-new",
        status: "open",
        description: "preserve incompatible new",
        occurrenceCount: 13,
        portfolioId: "portfolio-OTHER",
        mergedIntoId: null,
        suppressionReason: null,
      },
      {
        id: "incompatible-old",
        status: "suppressed",
        description: "preserve incompatible old",
        occurrenceCount: 7,
        portfolioId: "portfolio-2",
        mergedIntoId: "incompatible-new",
        suppressionReason: "index-repair-incompatible-duplicate",
      },
    ]);

    const overflow = (await client.query(`
      SELECT id, status, "occurrenceCount", "mergedIntoId", "suppressionReason"
      FROM "PlatformIssueReport"
      WHERE id IN ('overflow-old', 'overflow-new')
      ORDER BY id
    `)).rows;
    expect(overflow).toEqual([
      {
        id: "overflow-new",
        status: "open",
        occurrenceCount: 1,
        mergedIntoId: null,
        suppressionReason: null,
      },
      {
        id: "overflow-old",
        status: "suppressed",
        occurrenceCount: 2147483647,
        mergedIntoId: "overflow-new",
        suppressionReason: "index-repair-incompatible-duplicate",
      },
    ]);

    const underflow = (await client.query(`
      SELECT id, status, "occurrenceCount", "mergedIntoId", "suppressionReason"
      FROM "PlatformIssueReport"
      WHERE id IN ('underflow-old', 'underflow-new')
      ORDER BY id
    `)).rows;
    expect(underflow).toEqual([
      {
        id: "underflow-new",
        status: "open",
        occurrenceCount: -1,
        mergedIntoId: null,
        suppressionReason: null,
      },
      {
        id: "underflow-old",
        status: "suppressed",
        occurrenceCount: -2147483648,
        mergedIntoId: "underflow-new",
        suppressionReason: "index-repair-incompatible-duplicate",
      },
    ]);

    expect(await scalar(`
      SELECT count(*)::text value
      FROM "PlatformIssueReport"
      WHERE "dedupeKey" = 'log-sig:sandbox:terminal'
    `)).toBe(2);

    const indexes = (await client.query(`
      SELECT c.relname AS name, i.indisunique, i.indisvalid, i.indisready, i.indislive,
             pg_get_indexdef(i.indexrelid) AS definition,
             pg_get_expr(i.indpred, i.indrelid) AS predicate
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema()
        AND c.relname IN (
          'PlatformIssueReport_dedupeKey_idx',
          'PlatformIssueReport_dedupeKey_open_key',
          'PlatformIssueReport_mergedIntoId_idx'
        )
      ORDER BY c.relname
    `)).rows;
    expect(indexes).toHaveLength(3);
    expect(indexes.find((row) => row.name === "PlatformIssueReport_dedupeKey_open_key"))
      .toMatchObject({
        indisunique: true,
        indisvalid: true,
        indisready: true,
        indislive: true,
      });
    expect(indexes.find((row) => row.name === "PlatformIssueReport_dedupeKey_open_key")?.predicate)
      .toMatch(/resolved_locally.*resolved_upstream.*suppressed/);

    const foreignKey = (await client.query(`
      SELECT confdeltype, confupdtype
      FROM pg_constraint
      WHERE conrelid = '"PlatformIssueReport"'::regclass
        AND conname = 'PlatformIssueReport_mergedIntoId_fkey'
    `)).rows[0];
    expect(foreignKey).toEqual({ confdeltype: "n", confupdtype: "c" });

    await expect(client.query(`
      INSERT INTO "PlatformIssueReport" (
        id, "reportId", type, severity, status, title, source, "dedupeKey",
        "createdAt", "updatedAt"
      ) VALUES (
        'duplicate-after-repair', 'PIR-DUPLICATE-AFTER', 'runtime', 'medium',
        'open', 'must fail', 'automated', 'log-sig:sandbox:compatible',
        now(), now()
      )
    `)).rejects.toMatchObject({ code: "23505" });

    await expect(client.query(`
      INSERT INTO "PlatformIssueReport" (
        id, "reportId", type, severity, status, title, source, "dedupeKey",
        "createdAt", "updatedAt"
      ) VALUES (
        'triaged-duplicate-after-repair', 'PIR-TRIAGED-DUPLICATE-AFTER',
        'runtime', 'medium', 'triaged_local', 'must also fail', 'automated',
        'log-sig:sandbox:compatible', now(), now()
      )
    `)).rejects.toMatchObject({ code: "23505" });

    await expect(client.query(`
      INSERT INTO "PlatformIssueReport" (
        id, "reportId", type, severity, status, title, source, "dedupeKey",
        "createdAt", "updatedAt"
      ) VALUES (
        'resolved-upstream-after-repair', 'PIR-RESOLVED-UPSTREAM-AFTER',
        'runtime', 'medium', 'resolved_upstream', 'terminal reuse succeeds',
        'automated', 'log-sig:sandbox:terminal', now(), now()
      )
    `)).resolves.toBeDefined();

    const beforeSecondPass = JSON.stringify(await readRows());
    await client.query(migration);
    expect(JSON.stringify(await readRows())).toBe(beforeSecondPass);
  });
});
