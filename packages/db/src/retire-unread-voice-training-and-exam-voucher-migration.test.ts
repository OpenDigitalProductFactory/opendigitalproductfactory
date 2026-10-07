// BI-911840CB: the contraction the PortfolioBudgetPeriod and BudgetReservation
// raises cite. Two models no live code reads are retired: VoiceTrainingJob
// (unwritten since the Chatterbox zero-shot cut-over) and ExamVoucher (the leaf
// of the course-management schema whose code was reverted the night it landed).
//
// The migration must apply against ANY data state (AGENTS.md §2). An empty
// table is dropped. A table that still holds rows is never dropped: it is
// renamed to an archive table outside the Prisma schema, rows intact, with its
// indexes renamed so the original names are free again.
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const migrationPath = new URL(
  "../prisma/migrations/20261006200000_retire_voice_training_job_and_exam_voucher/migration.sql",
  import.meta.url,
);

// The two tables and their parents, exactly as the shipped migrations create them
// (20260520090000_voice_layer_v1, 20260323030000_add_course_management).
const FIXTURE_TABLES = `
  CREATE TABLE "VoiceProfile" (id TEXT PRIMARY KEY);
  CREATE TABLE "VoiceTrainingJob" (
    id TEXT NOT NULL,
    "voiceProfileId" TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    "providerJobId" TEXT,
    "inputSamples" JSONB NOT NULL DEFAULT '[]',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VoiceTrainingJob_pkey" PRIMARY KEY (id),
    CONSTRAINT "VoiceTrainingJob_voiceProfileId_fkey" FOREIGN KEY ("voiceProfileId")
      REFERENCES "VoiceProfile"(id) ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE INDEX "VoiceTrainingJob_voiceProfileId_status_idx" ON "VoiceTrainingJob"("voiceProfileId", status);

  CREATE TABLE "CourseRegistration" (id TEXT PRIMARY KEY);
  CREATE TABLE "ExamVoucher" (
    id TEXT NOT NULL,
    "registrationId" TEXT NOT NULL,
    "ogId" TEXT,
    "voucherType" TEXT,
    "voucherExpiry1" TIMESTAMP(3),
    "voucherExpiry2" TIMESTAMP(3),
    "ogStoreReference" TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExamVoucher_pkey" PRIMARY KEY (id)
  );
  CREATE UNIQUE INDEX "ExamVoucher_registrationId_key" ON "ExamVoucher"("registrationId");
  CREATE INDEX "ExamVoucher_ogId_idx" ON "ExamVoucher"("ogId");
  CREATE INDEX "ExamVoucher_status_idx" ON "ExamVoucher"(status);
  ALTER TABLE "ExamVoucher" ADD CONSTRAINT "ExamVoucher_registrationId_fkey" FOREIGN KEY ("registrationId")
    REFERENCES "CourseRegistration"(id) ON DELETE CASCADE ON UPDATE CASCADE;
`;

describe("retire VoiceTrainingJob and ExamVoucher migration shape", () => {
  it("drops only an empty table and archives a populated one instead", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("BI-911840CB");
    expect(sql).toMatch(/ARRAY\['VoiceTrainingJob',\s*'ExamVoucher'\]/);
    expect(sql).toMatch(/to_regclass/);
    expect(sql).toMatch(/SELECT EXISTS \(SELECT 1 FROM %I\)/);
    expect(sql).toMatch(/ALTER TABLE %I RENAME TO %I/);
    expect(sql).toMatch(/DROP TABLE %I/);
    // No unconditional drop of either table.
    expect(sql).not.toMatch(/DROP TABLE (IF EXISTS )?"(VoiceTrainingJob|ExamVoucher)"/);
    // The archive comment must not look like a dpf: governance declaration,
    // which the retention reader would try to parse.
    expect(sql).not.toMatch(/COMMENT ON TABLE[^;]*'dpf:/);
  });
});

async function tableExists(client: Client, name: string): Promise<boolean> {
  const result = await client.query<{ present: boolean }>(
    `SELECT to_regclass(format('%I', $1::text)) IS NOT NULL AS present`,
    [name],
  );
  return result.rows[0]?.present ?? false;
}

async function count(client: Client, table: string): Promise<number> {
  const result = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM "${table}"`);
  return Number(result.rows[0]?.n ?? 0);
}

describeDatabase("retire VoiceTrainingJob and ExamVoucher migration against Postgres", () => {
  let client: Client;
  const schemas: string[] = [];

  async function freshSchema(prefix: string): Promise<void> {
    const schema = `${prefix}_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(FIXTURE_TABLES);
  }

  beforeAll(async () => {
    client = new Client({ connectionString: databaseUrl });
    await client.connect();
  });

  afterAll(async () => {
    if (!client) return;
    for (const schema of schemas) await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("drops both tables when they are empty", async () => {
    await freshSchema("retire_empty");
    await client.query(await readFile(migrationPath, "utf8"));
    expect(await tableExists(client, "VoiceTrainingJob")).toBe(false);
    expect(await tableExists(client, "ExamVoucher")).toBe(false);
    expect(await tableExists(client, "VoiceTrainingJob_retired_bi911840cb")).toBe(false);
    expect(await tableExists(client, "ExamVoucher_retired_bi911840cb")).toBe(false);
    // Parents are untouched.
    expect(await tableExists(client, "VoiceProfile")).toBe(true);
    expect(await tableExists(client, "CourseRegistration")).toBe(true);
  });

  it("archives populated tables with every row intact and frees the original index names", async () => {
    await freshSchema("retire_rows");
    await client.query(`
      INSERT INTO "VoiceProfile" (id) VALUES ('vp1');
      INSERT INTO "VoiceTrainingJob" (id, "voiceProfileId", status, "errorMessage")
        VALUES ('j1', 'vp1', 'failed', 'provider rejected samples'), ('j2', 'vp1', 'ready', NULL);
      INSERT INTO "CourseRegistration" (id) VALUES ('r1');
      INSERT INTO "ExamVoucher" (id, "registrationId", "ogId", status, "updatedAt")
        VALUES ('v1', 'r1', 'OG-42', 'issued', CURRENT_TIMESTAMP);
    `);
    await client.query(await readFile(migrationPath, "utf8"));

    expect(await tableExists(client, "VoiceTrainingJob")).toBe(false);
    expect(await tableExists(client, "ExamVoucher")).toBe(false);
    expect(await count(client, "VoiceTrainingJob_retired_bi911840cb")).toBe(2);
    expect(await count(client, "ExamVoucher_retired_bi911840cb")).toBe(1);
    const voucher = await client.query(`SELECT "ogId", status FROM "ExamVoucher_retired_bi911840cb"`);
    expect(voucher.rows).toEqual([{ ogId: "OG-42", status: "issued" }]);

    const leftover = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = current_schema()
          AND (indexname LIKE 'VoiceTrainingJob\\_%' OR indexname LIKE 'ExamVoucher\\_%')
          AND indexname NOT LIKE '%retired%'`,
    );
    expect(leftover.rows).toEqual([]);

    const comment = await client.query<{ c: string | null }>(
      `SELECT obj_description(to_regclass('"ExamVoucher_retired_bi911840cb"'), 'pg_class') AS c`,
    );
    expect(comment.rows[0]?.c).toMatch(/BI-911840CB/);
    expect(comment.rows[0]?.c).not.toMatch(/^dpf:/);
  });

  it("applies when the tables were never created (fresh schema without them)", async () => {
    const schema = `retire_absent_${randomUUID().replaceAll("-", "")}`;
    schemas.push(schema);
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await expect(client.query(await readFile(migrationPath, "utf8"))).resolves.toBeDefined();
  });
});
