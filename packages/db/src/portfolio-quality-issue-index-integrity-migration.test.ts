import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `portfolio_quality_issue_repair_${randomUUID().replaceAll("-", "")}`;
let client: Client;

async function scalar(sql: string): Promise<number> {
  const result = await client.query<{ value: string }>(sql);
  return Number(result.rows[0]?.value ?? 0);
}

describeDatabase("PortfolioQualityIssue unique-index integrity migration", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "PortfolioQualityIssue" (
        id TEXT PRIMARY KEY,
        "issueKey" TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT NOT NULL,
        "firstDetectedAt" TIMESTAMP(3) NOT NULL,
        "lastDetectedAt" TIMESTAMP(3) NOT NULL
      );
      CREATE INDEX "PortfolioQualityIssue_issueKey_key" ON "PortfolioQualityIssue" ("issueKey");
      INSERT INTO "PortfolioQualityIssue"
        (id, "issueKey", status, summary, "firstDetectedAt", "lastDetectedAt") VALUES
        ('issue-old', 'stale-runtime', 'open', 'old observation', '2026-07-01', '2026-07-01'),
        ('issue-new', 'stale-runtime', 'open', 'new observation', '2026-07-20', '2026-07-20'),
        ('collision', '__dpf_quarantined__issue-old__stale-runtime', 'resolved', 'reserved collision', '2026-07-01', '2026-07-01');
    `);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("keeps the latest observation active, preserves losers, and rebuilds the unique index", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/20260720170000_repair_portfolio_quality_issue_index_integrity/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    await client.query(migration);

    expect(await scalar(`SELECT count(*)::text AS value FROM "PortfolioQualityIssue"`)).toBe(3);
    expect(
      await scalar(`
        SELECT count(*)::text AS value
        FROM (SELECT "issueKey" FROM "PortfolioQualityIssue" GROUP BY "issueKey" HAVING count(*) > 1) duplicate_groups
      `),
    ).toBe(0);
    expect(
      (await client.query(`SELECT "issueKey", summary FROM "PortfolioQualityIssue" WHERE id='issue-new'`)).rows[0],
    ).toEqual({ issueKey: "stale-runtime", summary: "new observation" });
    expect(
      (await client.query(`SELECT "issueKey", summary FROM "PortfolioQualityIssue" WHERE id='issue-old'`)).rows[0],
    ).toEqual({
      issueKey: "__dpf_quarantined__issue-old__stale-runtime_",
      summary: "old observation",
    });
    expect(
      await scalar(`
        SELECT count(*)::text AS value
        FROM pg_index i
        JOIN pg_class c ON c.oid=i.indexrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema()
          AND c.relname='PortfolioQualityIssue_issueKey_key'
          AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
      `),
    ).toBe(1);

    const beforeSecondPass = JSON.stringify(
      (await client.query(`SELECT * FROM "PortfolioQualityIssue" ORDER BY id`)).rows,
    );
    await client.query(migration);
    const afterSecondPass = JSON.stringify(
      (await client.query(`SELECT * FROM "PortfolioQualityIssue" ORDER BY id`)).rows,
    );
    expect(afterSecondPass).toBe(beforeSecondPass);
  });
});
