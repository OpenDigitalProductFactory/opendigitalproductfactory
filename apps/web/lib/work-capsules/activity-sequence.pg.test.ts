/**
 * The Workroom log's sequence trigger against a real Postgres (BI-62514632,
 * AC-DDL-LOG-TXN, AC-DDL-LOG-RESUME). Runs only when DPF_JOBS_TEST_DATABASE_URL
 * names a disposable database; it builds the two tables' relevant columns and
 * applies the committed migration. Without it every case is SKIPPED.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createJobsPool } from "@/lib/jobs/postgres/pool";
import { readActivityAfter } from "./activity-log-read";

const DATABASE_URL = process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() ?? "";
const MIGRATION = join(__dirname, "../../../../packages/db/prisma/migrations/20261013180000_workroom_activity_sequence/migration.sql");

const CREATE_ROOMS = `CREATE TABLE "WorkCapsule" (id TEXT PRIMARY KEY, "capsuleId" TEXT UNIQUE NOT NULL)`;
const CREATE_ACTIVITY = `CREATE TABLE "WorkCapsuleActivity" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "workCapsuleId" TEXT NOT NULL REFERENCES "WorkCapsule"(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, summary TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
const INSERT = `INSERT INTO "WorkCapsuleActivity" ("workCapsuleId", kind, summary) VALUES ($1, 'note', $2)`;

describe.skipIf(!DATABASE_URL)("Workroom log sequence (real database)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createJobsPool(DATABASE_URL, 12);
    await pool.query(`DROP TABLE IF EXISTS "WorkCapsuleActivity", "WorkCapsule" CASCADE`);
    await pool.query(CREATE_ROOMS);
    await pool.query(CREATE_ACTIVITY);
    // A row written before the migration keeps NULL.
    await pool.query(`INSERT INTO "WorkCapsule" (id, "capsuleId") VALUES ($1, $2)`, ["legacy", "WC-L"]);
    await pool.query(INSERT, ["legacy", "before"]);
    const sql = readFileSync(MIGRATION, "utf8");
    await pool.query(sql);
    await pool.query(sql); // additive and re-runnable
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM "WorkCapsuleActivity" WHERE "workCapsuleId" <> $1`, ["legacy"]);
    await pool.query(`DELETE FROM "WorkCapsule" WHERE id <> $1`, ["legacy"]);
    await pool.query(`INSERT INTO "WorkCapsule" (id, "capsuleId") VALUES ($1, $2), ($3, $4)`, ["row-1", "WC-1", "row-2", "WC-2"]);
  });

  /** One insert per connection and transaction, as concurrent portal requests write. */
  async function write(room: string, n: number) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(INSERT, [room, `w${n}`]);
      await new Promise((r) => setTimeout(r, 5));
      await client.query("COMMIT");
    } finally {
      client.release();
    }
  }

  async function sequences(room: string): Promise<Array<number | null>> {
    const { rows } = await pool.query(`SELECT sequence FROM "WorkCapsuleActivity" WHERE "workCapsuleId" = $1 ORDER BY sequence`, [room]);
    return rows.map((r: { sequence: number | null }) => r.sequence);
  }

  it("keeps the pre-migration row and gives it no sequence", async () => {
    expect(await sequences("legacy")).toEqual([null]);
  });

  it("numbers concurrent writes to one room 1..N with no gap or repeat, per room (AC-DDL-LOG-TXN)", async () => {
    await Promise.all([
      ...Array.from({ length: 20 }, (_, i) => write("row-1", i)),
      ...Array.from({ length: 5 }, (_, i) => write("row-2", i)),
    ]);
    expect(await sequences("row-1")).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(await sequences("row-2")).toEqual([1, 2, 3, 4, 5]);
    const { rows } = await pool.query(`SELECT "activitySequence" FROM "WorkCapsule" WHERE id = $1`, ["row-1"]);
    expect(rows[0].activitySequence).toBe(20);
  });

  it("a rolled-back write leaves no row and its number is never seen", async () => {
    await write("row-1", 1);
    const client = await pool.connect();
    await client.query("BEGIN");
    await client.query(INSERT, ["row-1", "lost"]);
    await client.query("ROLLBACK");
    client.release();
    await write("row-1", 2);
    expect(await sequences("row-1")).toEqual([1, 2]); // the counter update rolled back with the row
  });

  it("a reader resuming after N gets every later row once, in order (AC-DDL-LOG-RESUME)", async () => {
    for (let i = 0; i < 7; i++) await write("row-1", i);
    const db = {
      workroomActivity: {
        async findMany(args: unknown) {
          const a = args as { where: { workCapsuleId: string; sequence: { gt: number } }; take: number };
          const { rows } = await pool.query(
            `SELECT sequence, summary FROM "WorkCapsuleActivity" WHERE "workCapsuleId" = $1 AND sequence > $2 ORDER BY sequence LIMIT $3`,
            [a.where.workCapsuleId, a.where.sequence.gt, a.take]);
          return rows as unknown[];
        },
      },
    };
    const first = await readActivityAfter(db, { workCapsuleId: "row-1", afterSequence: 0, limit: 4 });
    const second = await readActivityAfter(db, { workCapsuleId: "row-1", afterSequence: 4, limit: 4 });
    expect(first.activity.map((r) => (r as { sequence: number }).sequence)).toEqual([1, 2, 3, 4]);
    expect(first.hasMore).toBe(true);
    expect(second.activity.map((r) => (r as { sequence: number }).sequence)).toEqual([5, 6, 7]);
    expect(second.hasMore).toBe(false);
  });
});
