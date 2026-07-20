import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const schema = `scheduled_job_repair_${randomUUID().replaceAll("-", "")}`;
let client: Client;

async function scalar(sql: string): Promise<number> {
  const result = await client.query<{ value: string }>(sql);
  return Number(result.rows[0]?.value ?? 0);
}

describeDatabase("ScheduledJob unique-index integrity migration", () => {
  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(`
      CREATE TABLE "ScheduledJob" (
        id TEXT PRIMARY KEY,
        "jobId" TEXT NOT NULL,
        name TEXT NOT NULL,
        "lastStatus" TEXT,
        "lastRunAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL,
        "updatedAt" TIMESTAMP(3) NOT NULL
      );
      CREATE INDEX "ScheduledJob_jobId_key" ON "ScheduledJob" ("jobId");
      INSERT INTO "ScheduledJob"
        (id, "jobId", name, "lastStatus", "lastRunAt", "createdAt", "updatedAt") VALUES
        ('job-old', 'eval-model', 'Old eval', 'failed', '2026-07-01', '2026-06-01', '2026-07-01'),
        ('job-new', 'eval-model', 'Current eval', 'completed', '2026-07-20', '2026-07-01', '2026-07-20'),
        ('collision', '__dpf_quarantined__job-old__eval-model', 'Reserved collision', 'completed', NULL, '2026-07-01', '2026-07-01');
    `);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("keeps the newest job state active, preserves losers, and rebuilds the unique index", async () => {
    const migration = await readFile(
      new URL(
        "../prisma/migrations/20260720180000_repair_scheduled_job_index_integrity/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );

    await client.query(migration);

    expect(await scalar(`SELECT count(*)::text AS value FROM "ScheduledJob"`)).toBe(3);
    expect(
      await scalar(`
        SELECT count(*)::text AS value
        FROM (SELECT "jobId" FROM "ScheduledJob" GROUP BY "jobId" HAVING count(*) > 1) duplicate_groups
      `),
    ).toBe(0);
    expect(
      (await client.query(`SELECT "jobId", name, "lastStatus" FROM "ScheduledJob" WHERE id='job-new'`)).rows[0],
    ).toEqual({ jobId: "eval-model", name: "Current eval", lastStatus: "completed" });
    expect(
      (await client.query(`SELECT "jobId", name, "lastStatus" FROM "ScheduledJob" WHERE id='job-old'`)).rows[0],
    ).toEqual({
      jobId: "__dpf_quarantined__job-old__eval-model_",
      name: "Old eval",
      lastStatus: "failed",
    });
    expect(
      await scalar(`
        SELECT count(*)::text AS value
        FROM pg_index i
        JOIN pg_class c ON c.oid=i.indexrelid
        JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=current_schema()
          AND c.relname='ScheduledJob_jobId_key'
          AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
      `),
    ).toBe(1);

    const beforeSecondPass = JSON.stringify((await client.query(`SELECT * FROM "ScheduledJob" ORDER BY id`)).rows);
    await client.query(migration);
    const afterSecondPass = JSON.stringify((await client.query(`SELECT * FROM "ScheduledJob" ORDER BY id`)).rows);
    expect(afterSecondPass).toBe(beforeSecondPass);
  });
});
