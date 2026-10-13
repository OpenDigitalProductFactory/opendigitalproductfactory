/**
 * Command receipts against a real Postgres (BI-763D6E01, AC-DDL-LEASE-SERIAL,
 * AC-DDL-RECEIPT-ONCE). Runs only when DPF_JOBS_TEST_DATABASE_URL names a
 * disposable database (the job engine's pattern); it creates its own tables
 * there from the committed migration. Without it every case is SKIPPED.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createJobsPool } from "@/lib/jobs/postgres/pool";
import { runReceiptedCommand, type ReceiptDb } from "./command-receipts";

const DATABASE_URL = process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() ?? "";
const MIGRATION = join(__dirname, "../../../../packages/db/prisma/migrations/20261013090000_workroom_command_receipts/migration.sql");

/** The slice of the Prisma client runReceiptedCommand uses, over one pg client. */
function receiptDb(client: PoolClient): ReceiptDb {
  return {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const text = strings.reduce((sql, part, i) => sql + part + (i < values.length ? `$${i + 1}` : ""), "");
      return (await client.query(text, values)).rows;
    },
    workroomActivity: {
      async findFirst(args: unknown) {
        const { commandScopeKey, commandKey } = (args as { where: { commandScopeKey: string; commandKey: string } }).where;
        const { rows } = await client.query(
          `SELECT kind, payload FROM "WorkCapsuleActivity" WHERE "commandScopeKey" = $1 AND "commandKey" = $2`,
          [commandScopeKey, commandKey]);
        return rows[0] ?? null;
      },
      async create(args: unknown) {
        const d = (args as { data: Record<string, unknown> }).data;
        await client.query(
          `INSERT INTO "WorkCapsuleActivity" (id, "workCapsuleId", kind, summary, payload, "commandScopeKey", "commandKey")
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4::jsonb, $5, $6)`,
          [d.workCapsuleId, d.kind, d.summary, JSON.stringify(d.payload), d.commandScopeKey, d.commandKey]);
        return d;
      },
    },
  };
}

describe.skipIf(!DATABASE_URL)("command receipts (real database)", () => {
  let pool: Pool;

  /** Each call gets its own connection and transaction, as two portal requests would. */
  function db(): ReceiptDb {
    return {
      ...receiptDb(undefined as never),
      async $transaction<T>(fn: (tx: ReceiptDb) => Promise<T>) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn(receiptDb(client));
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      },
    } as ReceiptDb;
  }

  beforeAll(async () => {
    pool = createJobsPool(DATABASE_URL, 6);
    await pool.query(`DROP TABLE IF EXISTS "WorkCapsuleActivity", "WorkCapsule" CASCADE;`);
    await pool.query(`CREATE TABLE "WorkCapsule" (id TEXT PRIMARY KEY, "capsuleId" TEXT UNIQUE NOT NULL, counter INT NOT NULL DEFAULT 0)`);
    // The pre-migration shape of the activity log's columns this test touches.
    await pool.query(`CREATE TABLE "WorkCapsuleActivity" (id TEXT PRIMARY KEY, "workCapsuleId" TEXT NOT NULL REFERENCES "WorkCapsule"(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, summary TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}', "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const sql = readFileSync(MIGRATION, "utf8");
    await pool.query(sql);
    await pool.query(sql); // additive and re-runnable
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE "WorkCapsuleActivity"; DELETE FROM "WorkCapsule"; INSERT INTO "WorkCapsule" (id, "capsuleId") VALUES ('row-1', 'WC-1')`);
  });

  /** A deliberately racy read-modify-write: without the room lock, concurrent calls lose updates. */
  function bump(commandId: string) {
    return runReceiptedCommand({
      db: db(),
      authorityScopeKey: "user:u|agent:a",
      commandId,
      commandType: "bump",
      target: { kind: "workroom", id: "WC-1" },
      run: async (tx) => {
        const [row] = (await tx.$queryRaw!`SELECT counter FROM "WorkCapsule" WHERE "capsuleId" = ${"WC-1"}`) as Array<{ counter: number }>;
        await new Promise((r) => setTimeout(r, 40));
        await tx.$queryRaw!`UPDATE "WorkCapsule" SET counter = ${row!.counter + 1} WHERE "capsuleId" = ${"WC-1"}`;
        return row!.counter + 1;
      },
    });
  }

  it("serialises concurrent commands on one room (AC-DDL-LEASE-SERIAL)", async () => {
    const results = await Promise.all([bump("a"), bump("b"), bump("c"), bump("d")]);
    expect(results.sort()).toEqual([1, 2, 3, 4]);
    expect((await pool.query(`SELECT counter FROM "WorkCapsule"`)).rows[0].counter).toBe(4);
  });

  it("runs one effect for concurrent retries of the same command id (AC-DDL-RECEIPT-ONCE)", async () => {
    const results = await Promise.all([bump("same"), bump("same"), bump("same")]);
    expect(new Set(results)).toEqual(new Set([1]));
    expect((await pool.query(`SELECT counter FROM "WorkCapsule"`)).rows[0].counter).toBe(1);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity" WHERE kind = 'command-accepted'`)).rows[0].n).toBe(1);
  });
});
