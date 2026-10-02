/**
 * The owned durable-job engine against a real Postgres (BI-85E6EF14).
 *
 * Runs only when DPF_JOBS_TEST_DATABASE_URL names a disposable database; it
 * drops and recreates the engine tables there from the committed migration.
 * Without it every case is reported SKIPPED, never passed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { JOB_CRON_EVENT_NAME, JOB_FAILURE_EVENT_NAME, type JobFunctionOptions } from "../types";
import { executeRun } from "./engine";
import { createJobsPool } from "./pool";
import { registerPostgresFunction, registeredFunction, resetPostgresRegistry, type RegisteredFunction } from "./registry";
import * as store from "./store";
import { createJobWorker, maxAttemptsFor } from "./worker";

const DATABASE_URL = process.env.DPF_JOBS_TEST_DATABASE_URL?.trim() ?? "";
const MIGRATION = join(__dirname, "../../../../../packages/db/prisma/migrations/20261001210000_durable_job_engine/migration.sql");
const TABLES = ['"JobConcurrencySlot"', '"JobWait"', '"JobStep"', '"JobRun"', '"JobEvent"', '"JobCronState"'];

describe.skipIf(!DATABASE_URL)("Postgres durable-job engine (real database)", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = createJobsPool(DATABASE_URL, 12);
    await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")} CASCADE; DROP TYPE IF EXISTS "JobRunStatus";`);
    const sql = readFileSync(MIGRATION, "utf8");
    await pool.query(sql);
    await pool.query(sql); // AC-M3-MIGRATION: a re-run is harmless.
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    resetPostgresRegistry();
    await pool.query(`TRUNCATE ${TABLES.join(", ")}`);
  });

  function define<T extends string>(options: JobFunctionOptions<T>, handler: (ctx: never) => unknown): RegisteredFunction {
    registerPostgresFunction(options as never, handler as never);
    return registeredFunction(options.id)!;
  }

  function worker(functions: RegisteredFunction[], extra: Partial<Parameters<typeof createJobWorker>[0]> = {}) {
    return createJobWorker({ pool, functions, schedulesEnabled: true, concurrency: 8, ...extra });
  }

  async function send(events: store.OutgoingEvent | store.OutgoingEvent[]) {
    return store.insertEvents(pool, Array.isArray(events) ? events : [events]);
  }

  async function runRow(functionKey: string) {
    const { rows } = await pool.query(`SELECT * FROM "JobRun" WHERE "functionKey" = $1 ORDER BY "createdAt"`, [functionKey]);
    return rows;
  }

  async function makeDue() {
    await pool.query(`UPDATE "JobRun" SET "runAfter" = now() - interval '1 second' WHERE status IN ('queued', 'sleeping')`);
  }

  it("memoises steps across replays, including repeated step ids (AC-M3-REPLAY)", async () => {
    const calls = { a: 0, again: 0, b: 0 };
    const fn = define({ id: "replay", retries: 2, triggers: [{ event: "t/replay" }] }, async ({ step }: never) => {
      const s = step as never as import("../types").JobStepTools;
      const a = await s.run("a", async () => ({ n: ++calls.a, when: new Date(0) }));
      const again1 = await s.run("again", async () => ++calls.again);
      const again2 = await s.run("again", async () => ++calls.again);
      const b = await s.run("b", async () => {
        calls.b++;
        if (calls.b === 1) throw new Error("transient");
        return "ok";
      });
      return { a, again1, again2, b };
    });
    const w = worker([fn]);
    await send({ name: "t/replay", data: {} });
    await w.drain();
    expect((await runRow("replay"))[0]).toMatchObject({ status: "queued", attempt: 1, error: "Error: transient" });
    await makeDue();
    await w.drain();
    const [run] = await runRow("replay");
    expect(run).toMatchObject({ status: "completed", attempt: 1 });
    expect(run.output).toEqual({ a: { n: 1, when: "1970-01-01T00:00:00.000Z" }, again1: 1, again2: 2, b: "ok" });
    expect(calls).toEqual({ a: 1, again: 2, b: 2 });
    const { rows } = await pool.query(`SELECT "stepKey" FROM "JobStep" ORDER BY "stepKey"`);
    expect(rows.map((r) => r.stepKey)).toEqual(["a", "again", "again:1", "b"]);
  });

  it("parks on sleep without holding a slot, and resumes past it (AC-M3-PARK)", async () => {
    let before = 0;
    const fn = define({ id: "sleeper", concurrency: { limit: 1 }, triggers: [{ event: "t/sleep" }] }, async ({ step }: never) => {
      const s = step as never as import("../types").JobStepTools;
      await s.run("before", async () => ++before);
      await s.sleep("nap", "1h");
      return "awake";
    });
    const w = worker([fn]);
    await send({ name: "t/sleep" });
    await w.drain();
    const [parked] = await runRow("sleeper");
    expect(parked.status).toBe("sleeping");
    expect(new Date(parked.runAfter).getTime()).toBeGreaterThan(Date.now() + 59 * 60_000);
    expect((await pool.query(`SELECT count(*)::int AS n FROM "JobConcurrencySlot"`)).rows[0].n).toBe(0);
    await w.drain();
    expect((await runRow("sleeper"))[0].status).toBe("sleeping");
    await makeDue();
    await w.drain();
    expect((await runRow("sleeper"))[0]).toMatchObject({ status: "completed", output: "awake" });
    expect(before).toBe(1);
  });

  it("resumes waitForEvent with the matching event only, or null on timeout (AC-M3-PARK)", async () => {
    const fn = define({ id: "waiter", triggers: [{ event: "t/wait" }] }, async ({ event, step }: never) => {
      const s = step as never as import("../types").JobStepTools;
      const e = event as { data: { key: string } };
      const got = await s.waitForEvent("done", { event: "t/done", timeout: "30m", if: `async.data.key == "${e.data.key}"` });
      return got ? got.data : "timed-out";
    });
    const w = worker([fn]);
    await send([{ id: "w1", name: "t/wait", data: { key: "K1" } }, { id: "w2", name: "t/wait", data: { key: "K2" } }]);
    await w.drain();
    expect((await runRow("waiter")).map((r) => r.status)).toEqual(["waiting", "waiting"]);
    await send({ name: "t/done", data: { key: "nope" } });
    await w.drain();
    expect((await runRow("waiter")).map((r) => r.status)).toEqual(["waiting", "waiting"]);
    await send({ name: "t/done", data: { key: "K1", extra: 1 } });
    await w.drain();
    const byEvent = Object.fromEntries((await runRow("waiter")).map((r) => [r.eventId, r]));
    expect(byEvent.w1).toMatchObject({ status: "completed", output: { key: "K1", extra: 1 } });
    expect(byEvent.w2.status).toBe("waiting");
    await pool.query(`UPDATE "JobWait" SET "expiresAt" = now() - interval '1 second'`);
    await w.maintain();
    await w.drain();
    expect((await runRow("waiter")).find((r) => r.eventId === "w2")).toMatchObject({ status: "completed", output: "timed-out" });
  });

  it("only matches events received after the wait began", async () => {
    const fn = define({ id: "late-waiter", triggers: [{ event: "t/lw" }] }, async ({ step }: never) => {
      const s = step as never as import("../types").JobStepTools;
      return (await s.waitForEvent("x", { event: "t/lw-done", timeout: "1h" })) ? "matched" : "none";
    });
    const w = worker([fn]);
    await send({ name: "t/lw-done" });
    await send({ name: "t/lw" });
    await w.drain();
    expect((await runRow("late-waiter"))[0].status).toBe("waiting");
  });

  it("retries, then runs onFailure with the failure event and fails (AC-M3-FAIL)", async () => {
    const failures: unknown[] = [];
    let attempts = 0;
    const fn = define(
      {
        id: "doomed",
        retries: 1,
        triggers: [{ event: "t/doom" }],
        onFailure: async ({ event, error, step }) => {
          await step.run("record", async () => failures.push({ name: event.name, original: (event.data as { event: { name: string } }).event.name, error: error.message }));
        },
      },
      async () => {
        attempts++;
        throw new Error(`boom ${attempts}`);
      },
    );
    const w = worker([fn]);
    await send({ name: "t/doom" });
    await w.drain();
    await makeDue();
    await w.drain();
    expect(attempts).toBe(2);
    expect((await runRow("doomed"))[0]).toMatchObject({ status: "failed", attempt: 2, error: "Error: boom 2" });
    expect(failures).toEqual([{ name: JOB_FAILURE_EVENT_NAME, original: "t/doom", error: "boom 2" }]);
  });

  it("cancels a parked run on a matching cancelOn event, and only that run (AC-M3-FAIL)", async () => {
    let finished = 0;
    const fn = define(
      { id: "cancellable", triggers: [{ event: "t/item" }], cancelOn: [{ event: "t/item.cancelled", match: "data.itemId" }] },
      async ({ step }: never) => {
        const s = step as never as import("../types").JobStepTools;
        await s.sleep("wait-a-bit", "1h");
        finished++;
      },
    );
    const w = worker([fn]);
    await send([{ id: "i1", name: "t/item", data: { itemId: "A" } }, { id: "i2", name: "t/item", data: { itemId: "B" } }]);
    await w.drain();
    await send({ name: "t/item.cancelled", data: { itemId: "A" } });
    await w.drain();
    await makeDue();
    await w.drain();
    const byEvent = Object.fromEntries((await runRow("cancellable")).map((r) => [r.eventId, r.status]));
    expect(byEvent).toEqual({ i1: "cancelled", i2: "completed" });
    expect(finished).toBe(1);
  });

  it("starts one run per function for a repeated event id (AC-M3-DEDUPE)", async () => {
    const fnA = define({ id: "dedupe-a", triggers: [{ event: "t/once" }] }, async () => "a");
    const fnB = define({ id: "dedupe-b", triggers: [{ event: "t/once" }] }, async () => "b");
    const w = worker([fnA, fnB]);
    const first = await send({ id: "same", name: "t/once" });
    const second = await send({ id: "same", name: "t/once", data: { different: true } });
    expect(first).toEqual(["same"]);
    expect(second).toEqual(["same"]);
    await w.drain();
    expect(await runRow("dedupe-a")).toHaveLength(1);
    expect(await runRow("dedupe-b")).toHaveLength(1);
  });

  it("never exceeds a lane's limit across concurrent claimers: limit 1, limit 2 and a shared account lane (AC-M3-LIMIT)", async () => {
    const active = new Map<string, number>();
    const peak = new Map<string, number>();
    const enter = (lane: string) => {
      const n = (active.get(lane) ?? 0) + 1;
      active.set(lane, n);
      peak.set(lane, Math.max(peak.get(lane) ?? 0, n));
    };
    const leave = (lane: string) => active.set(lane, (active.get(lane) ?? 1) - 1);
    const work = (lanes: (e: { data: { k: string } }) => string[]) => async ({ event, step }: never) => {
      const s = step as never as import("../types").JobStepTools;
      const ls = lanes(event as never);
      ls.forEach(enter);
      await new Promise((r) => setTimeout(r, 40));
      ls.forEach(leave);
      return s.run("done", async () => true);
    };
    const keyed = define(
      { id: "keyed-2", concurrency: [{ key: "event.data.k", limit: 2 }], triggers: [{ event: "t/keyed" }] },
      work((e) => [`keyed:${e.data.k}`]),
    );
    const single = define({ id: "single", concurrency: { limit: 1, scope: "fn" }, triggers: [{ event: "t/single" }] }, work(() => ["single"]));
    const laneA = define(
      { id: "lane-a", concurrency: [{ limit: 4 }, { scope: "account", key: "'pipeline'", limit: 3 }], triggers: [{ event: "t/lane" }] },
      work(() => ["account:pipeline"]),
    );
    const laneB = define(
      { id: "lane-b", concurrency: [{ limit: 4 }, { scope: "account", key: "'pipeline'", limit: 3 }], triggers: [{ event: "t/lane" }] },
      work(() => ["account:pipeline"]),
    );
    const fns = [keyed, single, laneA, laneB];
    const events: store.OutgoingEvent[] = [];
    for (let i = 0; i < 8; i++) {
      events.push({ name: "t/keyed", data: { k: i % 2 ? "x" : "y" } }, { name: "t/single", data: {} }, { name: "t/lane", data: {} });
    }
    await send(events);
    const workers = [worker(fns, { concurrency: 6 }), worker(fns, { concurrency: 6 }), worker(fns, { concurrency: 6 })];
    await Promise.all(workers.map((w) => w.drain()));
    for (let round = 0; round < 20; round++) {
      const left = (await pool.query(`SELECT count(*)::int AS n FROM "JobRun" WHERE status <> 'completed'`)).rows[0].n;
      if (left === 0) break;
      await Promise.all(workers.map((w) => w.drain()));
    }
    // 8 rounds x (keyed + single + the shared-lane event, which starts two functions) = 32 runs.
    expect((await pool.query(`SELECT count(*)::int AS n FROM "JobRun" WHERE status = 'completed'`)).rows[0].n).toBe(32);
    expect(peak.get("keyed:x")).toBeLessThanOrEqual(2);
    expect(peak.get("keyed:y")).toBeLessThanOrEqual(2);
    expect(peak.get("single")).toBe(1);
    expect(peak.get("account:pipeline")).toBeLessThanOrEqual(3);
    expect(Math.max(...peak.values())).toBeGreaterThan(1); // it did run in parallel
    expect((await pool.query(`SELECT count(*)::int AS n FROM "JobConcurrencySlot"`)).rows[0].n).toBe(0);
  });

  it("recovers a run whose worker died mid-step and finishes it exactly once (AC-M3-LEASE)", async () => {
    const calls = { first: 0, second: 0 };
    let releaseDeadWorker!: () => void;
    const deadWorkerGate = new Promise<void>((r) => (releaseDeadWorker = r));
    let gateFirstAttempt = true;
    const fn = define({ id: "crashy", triggers: [{ event: "t/crash" }] }, async ({ step }: never) => {
      const s = step as never as import("../types").JobStepTools;
      await s.run("first", async () => ++calls.first);
      return s.run("second", async () => {
        calls.second++;
        if (gateFirstAttempt) {
          gateFirstAttempt = false;
          await deadWorkerGate;
          return "from-dead-worker";
        }
        return "from-survivor";
      });
    });
    await send({ name: "t/crash" });
    await store.fanOutEvents(pool, [{ functionKey: fn.id, maxAttempts: maxAttemptsFor(fn), eventNames: fn.eventNames, cancelOn: [] }]);
    const [claimed] = await store.claimRuns(pool, { owner: "dead", leaseMs: 60_000, limit: 1, lanes: () => [], functionIds: [fn.id] });
    const dead = executeRun(pool, fn, claimed!, { owner: "dead", leaseMs: 60_000 });
    await new Promise((r) => setTimeout(r, 50)); // "first" is stored; "second" hangs: the process is gone.
    await pool.query(`UPDATE "JobRun" SET "leaseExpiresAt" = now() - interval '1 second'`);
    const survivor = worker([fn]);
    await survivor.maintain();
    await survivor.drain();
    expect((await runRow("crashy"))[0]).toMatchObject({ status: "completed", output: "from-survivor" });
    releaseDeadWorker();
    expect(await dead).toEqual({ kind: "lost" });
    expect((await runRow("crashy"))[0]).toMatchObject({ status: "completed", output: "from-survivor" });
    expect(calls).toEqual({ first: 1, second: 2 });
  });

  it("resumes a run parked mid-sleep or mid-wait under a new worker after a restart (AC-M3-LEASE)", async () => {
    let stepRuns = 0;
    const fn = define({ id: "restart", triggers: [{ event: "t/restart" }] }, async ({ step }: never) => {
      const s = step as never as import("../types").JobStepTools;
      await s.run("once", async () => ++stepRuns);
      await s.sleep("nap", "1h");
      const e = await s.waitForEvent("go", { event: "t/go", timeout: "1h" });
      return e ? "went" : "timed-out";
    });
    await send({ name: "t/restart" });
    await worker([fn], { owner: "before-restart" }).drain();
    expect((await runRow("restart"))[0].status).toBe("sleeping");
    await makeDue();
    await worker([fn], { owner: "after-restart-1" }).drain();
    expect((await runRow("restart"))[0].status).toBe("waiting");
    await send({ name: "t/go" });
    await worker([fn], { owner: "after-restart-2" }).drain();
    expect((await runRow("restart"))[0]).toMatchObject({ status: "completed", output: "went" });
    expect(stepRuns).toBe(1);
  });

  it("fires a due cron once per fire time, with no backfill", async () => {
    const fn = define({ id: "every-minute", triggers: [{ cron: "* * * * *" }] }, async ({ event }: never) => (event as { name: string }).name);
    const w = worker([fn]);
    await w.maintain();
    expect((await pool.query(`SELECT count(*)::int AS n FROM "JobCronState"`)).rows[0].n).toBe(1);
    await pool.query(`UPDATE "JobCronState" SET "nextFireAt" = now() - interval '3 hours'`);
    await w.maintain();
    await w.maintain();
    await w.drain();
    const runs = await runRow("every-minute");
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ status: "completed", output: JOB_CRON_EVENT_NAME });
    const { rows } = await pool.query(`SELECT "nextFireAt" FROM "JobCronState"`);
    expect(new Date(rows[0].nextFireAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("does not tick crons when scheduled functions are disabled", async () => {
    const fn = define({ id: "gated-cron", triggers: [{ cron: "* * * * *" }] }, async () => null);
    await worker([fn], { schedulesEnabled: false }).maintain();
    expect((await pool.query(`SELECT count(*)::int AS n FROM "JobCronState"`)).rows[0].n).toBe(0);
  });

  it("prunes finished runs and their events after the retention window, keeping live ones", async () => {
    const done = define({ id: "done-fn", triggers: [{ event: "t/done-fn" }] }, async () => "x");
    const waiting = define({ id: "waiting-fn", triggers: [{ event: "t/waiting-fn" }] }, async ({ step }: never) => {
      const s = step as never as import("../types").JobStepTools;
      return s.waitForEvent("never", { event: "t/never", timeout: "7d" });
    });
    const w = worker([done, waiting]);
    await send([{ name: "t/done-fn" }, { name: "t/waiting-fn" }]);
    await w.drain();
    await pool.query(`UPDATE "JobRun" SET "finishedAt" = now() - interval '30 days' WHERE status = 'completed'`);
    await pool.query(`UPDATE "JobEvent" SET "receivedAt" = now() - interval '30 days'`);
    const pruned = await store.pruneFinished(pool, new Date(Date.now() - 7 * 86_400_000));
    expect(pruned).toEqual({ runs: 1, events: 1 });
    expect(await runRow("done-fn")).toHaveLength(0);
    expect(await runRow("waiting-fn")).toHaveLength(1);
  });
});
