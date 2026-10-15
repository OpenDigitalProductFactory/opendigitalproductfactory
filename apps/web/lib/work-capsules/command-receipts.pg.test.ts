/**
 * BI-763D6E01: real Prisma/Postgres transport, transaction locks and replay.
 * Runs on an explicitly supplied disposable jobs DB or the canonical CI slot DB.
 * Every table lives in a uniquely named test schema; application tables are untouched.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabaseClient } from "@dpf/db";
import { CommandIdConflictError, ReplayedCommandRejection, runReceiptedCommand, type ReceiptDb } from "./command-receipts";

const slotUrl = process.env.DATABASE_URL?.trim() ?? "";
function canonicalSlotUrl() {
  try { return /^\/dpf_local_ci_[01]$/.test(new URL(slotUrl).pathname) ? slotUrl : ""; }
  catch { return ""; }
}
const DATABASE_URL = process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() || canonicalSlotUrl();
const SCHEMA = `dpf_receipt_test_${randomUUID().replaceAll("-", "")}`;
const MIGRATION = join(__dirname, "../../../../packages/db/prisma/migrations/20261013090000_workroom_command_receipts/migration.sql");
type RawTx = Pick<ReturnType<typeof createDatabaseClient>, "$queryRaw" | "$executeRaw">;

/** Real Prisma raw methods; the fixture's small activity model uses the same transaction. */
function receiptDb(tx: RawTx): ReceiptDb {
  return {
    $queryRaw: tx.$queryRaw.bind(tx),
    $executeRaw: tx.$executeRaw.bind(tx),
    workroomActivity: {
      async findFirst(args: unknown) {
        const { commandScopeKey, commandKey } = (args as { where: { commandScopeKey: string; commandKey: string } }).where;
        const rows = await tx.$queryRaw<Array<{ kind: string; payload: unknown }>>`
          SELECT kind, payload FROM "WorkCapsuleActivity" WHERE "commandScopeKey" = ${commandScopeKey} AND "commandKey" = ${commandKey}`;
        return rows[0] ?? null;
      },
      async create(args: unknown) {
        const d = (args as { data: Record<string, unknown> }).data;
        await tx.$executeRaw`
          INSERT INTO "WorkCapsuleActivity" (id, "workCapsuleId", kind, summary, payload, "commandScopeKey", "commandKey")
          VALUES (${randomUUID()}, ${d.workCapsuleId}, ${d.kind}, ${d.summary}, ${JSON.stringify(d.payload)}::jsonb, ${d.commandScopeKey}, ${d.commandKey})`;
        return d;
      },
    },
  };
}

describe.skipIf(!DATABASE_URL)("command receipts (real Prisma database)", () => {
  let pool: Pool;
  let prisma: ReturnType<typeof createDatabaseClient>;

  function db(): ReceiptDb {
    return {
      ...receiptDb(prisma),
      $transaction: (fn, options) => prisma.$transaction((tx) => fn(receiptDb(tx)), options),
    };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL, max: 6, options: `-c search_path=${SCHEMA}` });
    // SCHEMA is generated locally from a UUID, never supplied by a caller.
    await pool.query(`CREATE SCHEMA "${SCHEMA}"`);
    const connection = new URL(DATABASE_URL);
    connection.searchParams.set("options", `-c search_path=${SCHEMA}`);
    prisma = createDatabaseClient(connection.toString());
    await pool.query(`CREATE TABLE "WorkCapsule" (id TEXT PRIMARY KEY, "capsuleId" TEXT UNIQUE NOT NULL, counter INT NOT NULL DEFAULT 0)`);
    await pool.query(`CREATE TABLE "WorkCapsuleActivity" (id TEXT PRIMARY KEY, "workCapsuleId" TEXT NOT NULL REFERENCES "WorkCapsule"(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, summary TEXT NOT NULL, payload JSONB NOT NULL DEFAULT '{}', "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const sql = readFileSync(MIGRATION, "utf8");
    await pool.query(sql);
    await pool.query(sql);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (pool) {
      try { await pool.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`); }
      finally { await pool.end(); }
    }
  });

  beforeEach(async () => {
    await pool.query(`TRUNCATE "WorkCapsuleActivity"; DELETE FROM "WorkCapsule";
      INSERT INTO "WorkCapsule" (id, "capsuleId") VALUES ('row-1', 'WC-1'), ('row-2', 'WC-2')`);
  });

  /** Deliberately racy read/write: without the room lock concurrent increments are lost. */
  function bump(commandId: string, room = "WC-1", scope = "user:u|agent:a") {
    return runReceiptedCommand({
      db: db(), authorityScopeKey: scope, commandId, commandType: "bump", target: { kind: "workroom", id: room },
      run: async (tx) => {
        const [row] = (await tx.$queryRaw!`SELECT counter FROM "WorkCapsule" WHERE "capsuleId" = ${room}`) as Array<{ counter: number }>;
        await new Promise((r) => setTimeout(r, 40));
        await tx.$executeRaw!`UPDATE "WorkCapsule" SET counter = ${row!.counter + 1} WHERE "capsuleId" = ${room}`;
        return row!.counter + 1;
      },
    });
  }

  it("reproduces Prisma's void query rejection while execution acquires the lock", async () => {
    await expect(prisma.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"transport-probe"}, 0))`).rejects.toThrow(/void/i);
    await prisma.$transaction(async (tx) => {
      await expect(tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"transport-probe"}, 0))`).resolves.toBeTypeOf("number");
    });
  });

  it("serialises concurrent commands on one room (AC-DDL-LEASE-SERIAL)", async () => {
    const results = await Promise.all([bump("a"), bump("b"), bump("c"), bump("d")]);
    expect(results.sort()).toEqual([1, 2, 3, 4]);
    expect((await pool.query(`SELECT counter FROM "WorkCapsule" WHERE "capsuleId" = 'WC-1'`)).rows[0].counter).toBe(4);
  });

  it("runs one effect for concurrent retries (AC-DDL-RECEIPT-ONCE)", async () => {
    const results = await Promise.all([bump("same"), bump("same"), bump("same")]);
    expect(results).toEqual([1, 1, 1]);
    expect((await pool.query(`SELECT counter FROM "WorkCapsule" WHERE "capsuleId" = 'WC-1'`)).rows[0].counter).toBe(1);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity" WHERE kind = 'command-accepted'`)).rows[0].n).toBe(1);
  });

  it("serialises a shared command id across different rooms and refuses the losing target", async () => {
    const results = await Promise.allSettled([bump("same", "WC-1"), bump("same", "WC-2")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refusal = results.find((r) => r.status === "rejected");
    expect(refusal?.status === "rejected" && refusal.reason).toBeInstanceOf(CommandIdConflictError);
    expect((await pool.query(`SELECT sum(counter)::int AS n FROM "WorkCapsule"`)).rows[0].n).toBe(1);
  });

  it("keeps different principals' same command ids independent", async () => {
    expect((await Promise.all([bump("same", "WC-1", "user:u|agent:a"), bump("same", "WC-1", "user:v|agent:a")])).sort()).toEqual([1, 2]);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity"`)).rows[0].n).toBe(2);
  });

  it("rolls back the refused effect and replays its stored refusal (AC-DDL-RECEIPT-REJECT)", async () => {
    let calls = 0;
    const refusal = new Error("lease_held_by_other");
    const call = () => runReceiptedCommand({
      db: db(), authorityScopeKey: "user:u|agent:a", commandId: "refused", commandType: "bump", target: { kind: "workroom", id: "WC-1" },
      run: async (tx) => {
        calls += 1;
        await tx.$executeRaw!`UPDATE "WorkCapsule" SET counter = 99 WHERE "capsuleId" = ${"WC-1"}`;
        throw refusal;
      },
      rejectionOf: (error) => error === refusal ? { code: "lease_held_by_other", message: refusal.message } : null,
    });
    await expect(call()).rejects.toBe(refusal);
    await expect(call()).rejects.toBeInstanceOf(ReplayedCommandRejection);
    expect(calls).toBe(1);
    expect((await pool.query(`SELECT counter FROM "WorkCapsule" WHERE "capsuleId" = 'WC-1'`)).rows[0].counter).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "WorkCapsuleActivity" WHERE kind = 'command-rejected'`)).rows[0].n).toBe(1);
  });
});
