/**
 * QueueMetricSnapshot duration columns hold multi-week durations (BI-4ADFFEDB).
 * Runs only when DPF_JOBS_TEST_DATABASE_URL names a disposable database: it
 * builds the columns as they were (INTEGER), applies the committed migration,
 * and writes the value that failed on the live install. Without it every case
 * is SKIPPED.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createJobsPool } from "@/lib/jobs/postgres/pool";

const DATABASE_URL = process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() ?? "";
const MIGRATION = join(__dirname, "../../../../packages/db/prisma/migrations/20261014000000_queue_snapshot_duration_columns_double/migration.sql");
const COLUMNS = ["waitP50Ms", "waitP95Ms", "processP50Ms", "processP95Ms", "cycleP50Ms", "cycleP95Ms", "heldP50Ms", "heldP95Ms"];
// 28 days in milliseconds: the live rollup failed on 2,430,001,060.
const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000;

describe.skipIf(!DATABASE_URL)("QueueMetricSnapshot duration columns (real database)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createJobsPool(DATABASE_URL, 4);
    await pool.query(`DROP TABLE IF EXISTS "QueueMetricSnapshot"`);
    await pool.query(`CREATE TABLE "QueueMetricSnapshot" (id TEXT PRIMARY KEY, ${COLUMNS.map((c) => `"${c}" INTEGER`).join(", ")})`);
    await pool.query(`INSERT INTO "QueueMetricSnapshot" (id, "cycleP50Ms") VALUES ('before', 123456)`);
    const sql = readFileSync(MIGRATION, "utf8");
    await pool.query(sql);
    await pool.query(sql); // re-runnable
  });

  afterAll(async () => {
    await pool?.query(`DROP TABLE IF EXISTS "QueueMetricSnapshot"`);
    await pool?.end();
  });

  it("keeps existing values and stores a four-week duration in every column", async () => {
    expect((await pool.query(`SELECT "cycleP50Ms" FROM "QueueMetricSnapshot" WHERE id = 'before'`)).rows[0].cycleP50Ms).toBe(123456);
    await pool.query(
      `INSERT INTO "QueueMetricSnapshot" (id, ${COLUMNS.map((c) => `"${c}"`).join(", ")}) VALUES ('long', ${COLUMNS.map((_, i) => `$${i + 1}`).join(", ")})`,
      COLUMNS.map(() => FOUR_WEEKS_MS),
    );
    const row = (await pool.query(`SELECT * FROM "QueueMetricSnapshot" WHERE id = 'long'`)).rows[0];
    for (const column of COLUMNS) expect(row[column]).toBe(FOUR_WEEKS_MS);
  });
});
