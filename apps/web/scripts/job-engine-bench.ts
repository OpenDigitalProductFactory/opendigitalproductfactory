/**
 * Spec 2026-09-25 §7 benchmarks and failure drills for the owned durable-job
 * engine (BI-85E6EF14, AC-M3-BENCH).
 *
 *   DPF_JOBS_BENCH_DATABASE_URL=postgres://…/<a *_test or *_bench database> \
 *     pnpm --filter web exec tsx scripts/job-engine-bench.ts [--rate 21] [--seconds 120]
 *
 * It DROPS and recreates the engine tables in that database from the committed
 * migration, so it refuses any database whose name does not contain "test" or
 * "bench". Prints one JSON summary on stdout.
 *
 * Measures:
 *   1. event-to-first-step latency at a sustained rate (default 21/s: 10x the
 *      busiest observed hour, 7,285 runs on 2026-09-29 19:00 UTC);
 *   2. claim throughput with 125 functions and 84 concurrency configurations
 *      under an overlapping cron minute plus an event burst, two workers;
 *   3. Postgres load: WAL bytes per run, connections held;
 *   4. drills: SIGKILL a worker process mid-step, mid-sleep and mid-wait, then
 *      prove each run resumes and completes once, completed steps not re-run.
 */
import { fork } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Pool } from "pg";

import { createJobsPool } from "@/lib/jobs/postgres/pool";
import { registerPostgresFunction, registeredFunction, resetPostgresRegistry, type RegisteredFunction } from "@/lib/jobs/postgres/registry";
import * as store from "@/lib/jobs/postgres/store";
import { createJobWorker } from "@/lib/jobs/postgres/worker";
import type { JobStepTools } from "@/lib/jobs/types";

const URL = process.env.DPF_JOBS_BENCH_DATABASE_URL?.trim() ?? "";
const MIGRATION = join(__dirname, "../../../packages/db/prisma/migrations/20261001210000_durable_job_engine/migration.sql");
const TABLES = ['"JobConcurrencySlot"', '"JobWait"', '"JobStep"', '"JobRun"', '"JobEvent"', '"JobCronState"'];

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
}

function percentiles(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]! : NaN;
  return { n: sorted.length, p50: at(0.5), p90: at(0.9), p99: at(0.99), max: sorted.at(-1) ?? NaN };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function define(options: Parameters<typeof registerPostgresFunction>[0], handler: (ctx: { event: { id: string; data: Record<string, unknown> }; step: JobStepTools }) => unknown): RegisteredFunction {
  registerPostgresFunction(options, handler as never);
  return registeredFunction(options.id)!;
}

async function reset(pool: Pool) {
  await pool.query(`DROP TABLE IF EXISTS ${TABLES.join(", ")}, bench_marks CASCADE; DROP TYPE IF EXISTS "JobRunStatus";`);
  await pool.query(readFileSync(MIGRATION, "utf8"));
  await pool.query(`CREATE TABLE bench_marks (run text, mark text, at timestamptz DEFAULT now())`);
}

async function walLsn(pool: Pool): Promise<string> {
  return (await pool.query<{ lsn: string }>("SELECT pg_current_wal_lsn()::text AS lsn")).rows[0]!.lsn;
}

async function walBytes(pool: Pool, from: string, to: string): Promise<number> {
  return Number((await pool.query<{ d: string }>("SELECT pg_wal_lsn_diff($2::pg_lsn, $1::pg_lsn)::text AS d", [from, to])).rows[0]!.d);
}

// ─── 1 + 3. Sustained latency, WAL and connections ─────────────────────────

async function latencyBench(pool: Pool, rate: number, seconds: number) {
  resetPostgresRegistry();
  await reset(pool);
  const firstStep = new Map<string, number>();
  const fn = define({ id: "bench/latency", retries: 0, concurrency: { limit: 32 }, triggers: [{ event: "bench/tick" }] }, async ({ event, step }) => {
    await step.run("first", async () => {
      if (!firstStep.has(event.id)) firstStep.set(event.id, performance.now());
      return true;
    });
  });
  const worker = createJobWorker({ pool, functions: [fn], schedulesEnabled: false, concurrency: 16, pollMs: 2_000 });
  await worker.start();
  const sentAt = new Map<string, number>();
  const lsnBefore = await walLsn(pool);
  let connectionsPeak = 0;
  const started = performance.now();
  const total = Math.round(rate * seconds);
  for (let i = 0; i < total; i++) {
    const due = started + (i * 1000) / rate;
    const wait = due - performance.now();
    if (wait > 0) await sleep(wait);
    const id = `lat-${i}`;
    sentAt.set(id, performance.now());
    await store.insertEvents(pool, [{ id, name: "bench/tick", data: { i } }]);
    if (i % Math.max(1, Math.round(rate * 5)) === 0) {
      const c = (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name = 'dpf-jobs'`)).rows[0]!.n;
      connectionsPeak = Math.max(connectionsPeak, c);
    }
  }
  const deadline = performance.now() + 60_000;
  while (firstStep.size < total && performance.now() < deadline) await sleep(100);
  const elapsed = (performance.now() - started) / 1000;
  const completed = (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "JobRun" WHERE status = 'completed'`)).rows[0]!.n;
  await worker.stop();
  const lsnAfter = await walLsn(pool);
  const latencies = [...sentAt].filter(([id]) => firstStep.has(id)).map(([id, t]) => firstStep.get(id)! - t);
  return {
    rate,
    seconds,
    events: total,
    completed,
    achievedRunsPerSecond: Number((completed / elapsed).toFixed(1)),
    eventToFirstStepMs: Object.fromEntries(Object.entries(percentiles(latencies)).map(([k, v]) => [k, Number(v.toFixed(1))])),
    walBytesPerRun: Math.round((await walBytes(pool, lsnBefore, lsnAfter)) / Math.max(1, completed)),
    connectionsPeak,
  };
}

// ─── 2. Contention: 125 functions, overlapping cron minute ─────────────────

async function contentionBench(pool: Pool) {
  resetPostgresRegistry();
  await reset(pool);
  const fns: RegisteredFunction[] = [];
  const work = async ({ step }: { step: JobStepTools }) => step.run("work", async () => {
    await sleep(5);
    return true;
  });
  for (let i = 0; i < 74; i++) {
    fns.push(define({ id: `bench/cron-${i}`, retries: 1, concurrency: { limit: 1, scope: "fn" }, triggers: [{ cron: "* * * * *" }] }, work as never));
  }
  for (let i = 0; i < 51; i++) {
    // 74 cron + 6 keyed + 4 on the shared account lane = the spec's 84 concurrency configurations.
    const keyed = i < 6;
    const accountLane = [10, 15, 20, 25].includes(i);
    fns.push(define({
      id: `bench/event-${i}`,
      retries: 1,
      ...(keyed ? { concurrency: [{ key: "event.data.k", limit: 1 }] } : accountLane ? { concurrency: [{ limit: 2 }, { scope: "account", key: "'bench-lane'", limit: 3 }] } : {}),
      triggers: [{ event: `bench/e-${i}` }],
    }, work as never));
  }
  const configs = fns.filter((fn) => fn.options.concurrency).length;
  const workers = [0, 1].map(() => createJobWorker({ pool, functions: fns, schedulesEnabled: true, concurrency: 8 }));
  await workers[0]!.maintain(); // registers the 74 cron schedules
  await pool.query(`UPDATE "JobCronState" SET "nextFireAt" = now() - interval '1 second'`);
  const events: store.OutgoingEvent[] = [];
  for (let n = 0; n < 500; n++) events.push({ name: `bench/e-${n % 51}`, data: { k: `k${n % 7}` } });
  await store.insertEvents(pool, events);
  const started = performance.now();
  await workers[0]!.maintain(); // the overlapping minute: all 74 crons fire at once
  const claimDurations: number[] = [];
  const expected = 74 + 500;
  for (;;) {
    const t = performance.now();
    await Promise.all(workers.map((w) => w.drain()));
    claimDurations.push(performance.now() - t);
    const done = (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "JobRun" WHERE status = 'completed'`)).rows[0]!.n;
    if (done >= expected || performance.now() - started > 120_000) break;
  }
  const elapsed = (performance.now() - started) / 1000;
  const done = (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "JobRun" WHERE status = 'completed'`)).rows[0]!.n;
  const leftoverSlots = (await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM "JobConcurrencySlot"`)).rows[0]!.n;
  return { functions: fns.length, concurrencyConfigs: configs, runs: expected, completed: done, seconds: Number(elapsed.toFixed(2)), runsPerSecond: Number((done / elapsed).toFixed(1)), leftoverSlots };
}

// ─── 4. Kill drills (real SIGKILL of a worker process) ─────────────────────

function drillFunctions(fast: boolean) {
  resetPostgresRegistry();
  const mark = async (pool: Pool, run: string, m: string) => pool.query(`INSERT INTO bench_marks (run, mark) VALUES ($1, $2)`, [run, m]);
  return (pool: Pool) => [
    define({ id: "drill/step", retries: 0, triggers: [{ event: "drill/step" }] }, async ({ event, step }) => {
      await step.run("first", async () => mark(pool, event.id, "first").then(() => 1));
      return step.run("slow", async () => {
        await mark(pool, event.id, "slow-start");
        if (!fast) await sleep(60_000);
        return "done";
      });
    }),
    define({ id: "drill/sleep", retries: 0, triggers: [{ event: "drill/sleep" }] }, async ({ event, step }) => {
      await step.run("first", async () => mark(pool, event.id, "first").then(() => 1));
      await step.sleep("nap", "3s");
      return step.run("after", async () => mark(pool, event.id, "after").then(() => "done"));
    }),
    define({ id: "drill/wait", retries: 0, triggers: [{ event: "drill/wait" }] }, async ({ event, step }) => {
      await step.run("first", async () => mark(pool, event.id, "first").then(() => 1));
      const got = await step.waitForEvent("go", { event: "drill/go", timeout: "5m" });
      return got ? "done" : "timed-out";
    }),
  ];
}

async function drillChild(fast: boolean) {
  const pool = createJobsPool(URL, 4);
  const worker = createJobWorker({ pool, functions: drillFunctions(fast)(pool), schedulesEnabled: false, leaseMs: 2_000, pollMs: 200, maintenanceMs: 500 });
  await worker.start();
  process.send?.("ready");
  await new Promise(() => {});
}

async function drills(pool: Pool) {
  resetPostgresRegistry();
  await reset(pool);
  const spawn = (fast: boolean) => new Promise<ReturnType<typeof fork>>((resolve) => {
    const child = fork(__filename, ["--drill-child", fast ? "fast" : "slow"], { execArgv: process.execArgv, env: process.env, stdio: "ignore" });
    child.once("message", () => resolve(child));
  });
  const marks = async (run: string) => (await pool.query<{ mark: string; n: number }>(`SELECT mark, count(*)::int AS n FROM bench_marks WHERE run = $1 GROUP BY mark`, [run])).rows
    .reduce((acc, r) => ({ ...acc, [r.mark]: r.n }), {} as Record<string, number>);
  const runOf = async (eventId: string) => (await pool.query(`SELECT status, output FROM "JobRun" WHERE "eventId" = $1`, [eventId])).rows;
  const until = async (check: () => Promise<boolean>, ms: number) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await check()) return true;
      await sleep(100);
    }
    return false;
  };
  const results: Record<string, unknown> = {};

  // mid-step: kill while "slow" runs; the survivor redoes "slow", never "first".
  let child = await spawn(false);
  await store.insertEvents(pool, [{ id: "d-step", name: "drill/step" }]);
  await until(async () => (await marks("d-step"))["slow-start"] === 1, 15_000);
  child.kill("SIGKILL");
  child = await spawn(true);
  await until(async () => (await runOf("d-step"))[0]?.status === "completed", 30_000);
  results.midStep = { run: await runOf("d-step"), executions: await marks("d-step") };

  // mid-sleep: kill while parked; a new process resumes it after the nap.
  await store.insertEvents(pool, [{ id: "d-sleep", name: "drill/sleep" }]);
  await until(async () => (await runOf("d-sleep"))[0]?.status === "sleeping", 15_000);
  child.kill("SIGKILL");
  child = await spawn(true);
  await until(async () => (await runOf("d-sleep"))[0]?.status === "completed", 30_000);
  results.midSleep = { run: await runOf("d-sleep"), executions: await marks("d-sleep") };

  // mid-wait: kill while waiting; the event arrives with no worker alive.
  await store.insertEvents(pool, [{ id: "d-wait", name: "drill/wait" }]);
  await until(async () => (await runOf("d-wait"))[0]?.status === "waiting", 15_000);
  child.kill("SIGKILL");
  await store.insertEvents(pool, [{ id: "d-go", name: "drill/go" }]);
  child = await spawn(true);
  await until(async () => (await runOf("d-wait"))[0]?.status === "completed", 30_000);
  results.midWait = { run: await runOf("d-wait"), executions: await marks("d-wait") };
  child.kill("SIGKILL");

  const ok = (r: { run: Array<{ status: string }>; executions: Record<string, number> }) =>
    r.run.length === 1 && r.run[0]!.status === "completed" && r.executions.first === 1;
  results.allPassed = [results.midStep, results.midSleep, results.midWait].every((r) => ok(r as never));
  return results;
}

async function main() {
  if (!URL) throw new Error("Set DPF_JOBS_BENCH_DATABASE_URL to a disposable database.");
  const dbName = new globalThis.URL(URL).pathname.slice(1);
  if (!/test|bench/.test(dbName)) throw new Error(`Refusing database ${JSON.stringify(dbName)}: its name must contain "test" or "bench".`);
  if (process.argv.includes("--drill-child")) return drillChild(process.argv.includes("fast"));
  const pool = createJobsPool(URL, 12);
  try {
    const host = (await pool.query<{ v: string }>("SELECT version() AS v")).rows[0]!.v.split(" ").slice(0, 2).join(" ");
    const latency = await latencyBench(pool, arg("rate", 21), arg("seconds", 120));
    const contention = await contentionBench(pool);
    const drill = await drills(pool);
    console.log(JSON.stringify({ measuredAt: new Date().toISOString(), postgres: host, latency, contention, drills: drill }, null, 2));
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
