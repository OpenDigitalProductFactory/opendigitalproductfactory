/**
 * The Workroom runtime outbox's SQL against a real Postgres (BI-C64EDA33,
 * AC-2/AC-3/AC-4). Runs only when DPF_JOBS_TEST_DATABASE_URL names a
 * disposable database; it builds the room table's relevant columns and applies
 * the committed migration. Without it every case is SKIPPED.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createJobsPool } from "@/lib/jobs/postgres/pool";
import { claimEffects, insertEffects, recoverExpiredLeases, retireEffects, settleEffect, type SqlRunner } from "./workroom-effect-store";

const DATABASE_URL = process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() ?? "";
const MIGRATION = join(__dirname, "../../../../packages/db/prisma/migrations/20261114050000_workroom_effect_outbox/migration.sql");
const T0 = new Date("2026-11-14T05:00:00.000Z");
const later = (ms: number) => new Date(T0.getTime() + ms);

describe.skipIf(!DATABASE_URL)("Workroom runtime outbox (real database)", () => {
  let pool: Pool;
  let run: SqlRunner;

  beforeAll(async () => {
    pool = createJobsPool(DATABASE_URL, 4);
    run = { query: async <T>(sql: string, params: unknown[]) => (await pool.query(sql, params)).rows as T[] };
    await pool.query(`DROP TABLE IF EXISTS "WorkroomEffect", "WorkCapsule" CASCADE`);
    await pool.query(`DROP TYPE IF EXISTS "WorkroomEffectKind", "WorkroomEffectStatus"`);
    await pool.query(`CREATE TABLE "WorkCapsule" (id TEXT PRIMARY KEY, "capsuleId" TEXT UNIQUE NOT NULL)`);
    const sql = readFileSync(MIGRATION, "utf8");
    await pool.query(sql);
    await pool.query(sql); // additive and re-runnable
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM "WorkroomEffect"`);
    await pool.query(`DELETE FROM "WorkCapsule"`);
    await pool.query(`INSERT INTO "WorkCapsule" (id, "capsuleId") VALUES ('row-1','WC-1'), ('row-2','WC-2')`);
  });

  const statuses = async () => (await pool.query(`SELECT "commandId", "status"::text AS status FROM "WorkroomEffect" ORDER BY "sequence"`)).rows;
  const claim = (liveGenerations: string[], now = T0) => claimEffects(run, { owner: "host-1", liveGenerations, limit: 10, leaseMs: 60_000, now });

  it("inserts a decision's effects once, however often the decision is replayed", async () => {
    const effects = [{ kind: "start-turn" as const, payload: { prompt: "a" } }, { kind: "revoke-token" as const, payload: { tokenId: "t" } }];
    await insertEffects(run, { roomRowId: "row-1", commandId: "cmd-1", generation: "gen-1", effects, now: T0 });
    await insertEffects(run, { roomRowId: "row-1", commandId: "cmd-1", generation: "gen-1", effects, now: T0 });
    const rows = (await pool.query(`SELECT "kind"::text AS kind, "processBound", "sessionGeneration" FROM "WorkroomEffect" ORDER BY "ordinal"`)).rows;
    expect(rows).toEqual([
      { kind: "start-turn", processBound: true, sessionGeneration: "gen-1" },
      { kind: "revoke-token", processBound: false, sessionGeneration: null },
    ]);
  });

  it("runs a room's effects one at a time in order, rooms in parallel, and process-bound ones only where their process lives", async () => {
    await insertEffects(run, { roomRowId: "row-1", commandId: "a", generation: "gen-1", effects: [{ kind: "start-turn", payload: {} }], now: T0 });
    await insertEffects(run, { roomRowId: "row-1", commandId: "b", generation: "gen-1", effects: [{ kind: "revoke-token", payload: {} }], now: T0 });
    await insertEffects(run, { roomRowId: "row-2", commandId: "c", generation: "gen-9", effects: [{ kind: "start-turn", payload: {} }], now: T0 });
    // gen-9 is not this process's: room 2 waits; room 1's second effect waits behind its first.
    expect((await claim(["gen-1"])).map((e) => [e.commandId, e.capsuleId, e.attemptCount])).toEqual([["a", "WC-1", 1]]);
    expect(await claim(["gen-1"])).toEqual([]);
    const [a] = (await pool.query(`SELECT id FROM "WorkroomEffect" WHERE "commandId"='a'`)).rows as Array<{ id: string }>;
    expect(await settleEffect(run, { effectId: a!.id, attempt: 1, status: "succeeded" }, T0)).toBe(true);
    expect((await claim(["gen-1"])).map((e) => e.commandId)).toEqual(["b"]);
  });

  it("a retry waits out its backoff and blocks the room's later effects meanwhile", async () => {
    await insertEffects(run, { roomRowId: "row-1", commandId: "a", generation: null, effects: [{ kind: "revoke-token", payload: {} }], now: T0 });
    await insertEffects(run, { roomRowId: "row-1", commandId: "b", generation: null, effects: [{ kind: "revoke-token", payload: {} }], now: T0 });
    const [first] = await claim([]);
    await settleEffect(run, { effectId: first!.id, attempt: 1, status: "pending", error: "busy", retryAfterMs: 5000 }, T0);
    expect(await claim([], later(1000))).toEqual([]);
    expect((await claim([], later(6000))).map((e) => [e.commandId, e.attemptCount])).toEqual([["a", 2]]);
  });

  it("a report from an attempt that lost its lease changes nothing", async () => {
    await insertEffects(run, { roomRowId: "row-1", commandId: "a", generation: null, effects: [{ kind: "revoke-token", payload: {} }], now: T0 });
    const [first] = await claim([]);
    expect(await recoverExpiredLeases(run, later(120_000))).toBe(1);
    const [second] = await claim([], later(120_000));
    expect(second!.attemptCount).toBe(2);
    expect(await settleEffect(run, { effectId: first!.id, attempt: 1, status: "succeeded" }, later(120_000))).toBe(false);
    expect(await settleEffect(run, { effectId: second!.id, attempt: 2, status: "succeeded" }, later(120_000))).toBe(true);
  });

  it("retires unsettled process-bound effects of other generations and leaves the rest", async () => {
    await insertEffects(run, { roomRowId: "row-1", commandId: "old", generation: "gen-1", effects: [{ kind: "answer-request", payload: {} }], now: T0 });
    await insertEffects(run, { roomRowId: "row-1", commandId: "revoke", generation: "gen-1", effects: [{ kind: "revoke-token", payload: {} }], now: T0 });
    await insertEffects(run, { roomRowId: "row-1", commandId: "new", generation: "gen-2", effects: [{ kind: "start-turn", payload: {} }], now: T0 });
    const retired = await retireEffects(run, { roomRowId: "row-1", keepGeneration: "gen-2", reason: "new process", now: T0 });
    expect(retired.map((r) => r.kind)).toEqual(["answer-request"]);
    expect(await statuses()).toEqual([
      { commandId: "old", status: "retired" }, { commandId: "revoke", status: "pending" }, { commandId: "new", status: "pending" },
    ]);
    await retireEffects(run, { roomRowId: "row-1", keepGeneration: null, reason: "stopped", now: T0 });
    expect((await statuses()).map((r) => r.status)).toEqual(["retired", "pending", "retired"]);
  });
});
