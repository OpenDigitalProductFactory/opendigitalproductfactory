/**
 * The worker loop of the owned durable-job engine (spec 2026-09-25 §5.3-§5.4).
 *
 * Runs inside the portal process; no extra container. It wakes on
 * `LISTEN dpf_jobs` and polls as a fallback, so a missed notification costs at
 * most one poll interval. Each wake fans out new events, then claims and
 * executes due runs up to its parallelism. Maintenance (lease recovery, wait
 * timeouts, cron ticks, retention) runs on its own interval.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { getErrorMessage } from "@/lib/shared/get-error-message";

import { executeRun, type RunOutcome } from "./engine";
import { lanesFor } from "./lanes";
import { DEFAULT_RETRIES, type RegisteredFunction } from "./registry";
import * as store from "./store";

export type JobWorkerOptions = {
  pool: Pool;
  functions: readonly RegisteredFunction[];
  /** Cron functions only tick when scheduled functions are enabled (DPF_SCHEDULED_INNGEST_FUNCTIONS_ENABLED). */
  schedulesEnabled: boolean;
  owner?: string;
  leaseMs?: number;
  concurrency?: number;
  pollMs?: number;
  maintenanceMs?: number;
  retentionMs?: number;
  onOutcome?: (functionKey: string, outcome: RunOutcome) => void;
};

export type JobWorker = {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** One full pass: fan out, then claim and run until nothing is due. For tests and drills. */
  drain(): Promise<number>;
  maintain(): Promise<void>;
  readonly owner: string;
};

export function maxAttemptsFor(fn: RegisteredFunction): number {
  return (fn.options.retries ?? DEFAULT_RETRIES) + 1;
}

export function createJobWorker(options: JobWorkerOptions): JobWorker {
  const owner = options.owner ?? `worker_${randomUUID()}`;
  const leaseMs = options.leaseMs ?? 5 * 60_000;
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const pollMs = options.pollMs ?? 2_000;
  const maintenanceMs = options.maintenanceMs ?? 15_000;
  const retentionMs = options.retentionMs ?? 7 * 24 * 60 * 60_000;
  const byId = new Map(options.functions.map((fn) => [fn.id, fn]));
  const functionIds = [...byId.keys()];
  const targets: store.FanOutTarget[] = options.functions.map((fn) => ({
    functionKey: fn.id,
    maxAttempts: maxAttemptsFor(fn),
    eventNames: fn.eventNames,
    cancelOn: fn.options.cancelOn ?? [],
  }));
  const schedules = new Map<string, store.CronSchedule>(
    options.schedulesEnabled
      ? options.functions.filter((fn) => fn.crons.length > 0).map((fn) => [fn.id, { crons: fn.crons, maxAttempts: maxAttemptsFor(fn) }])
      : [],
  );

  const inFlight = new Set<Promise<void>>();
  let running = false;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  let listener: PoolClient | null = null;
  let pumping = false;
  let pumpAgain = false;
  let lastPrune = 0;

  const lanes = (run: store.JobRunRow) => lanesFor(run.functionKey, byId.get(run.functionKey)?.options.concurrency, run.event);

  async function execute(run: store.JobRunRow): Promise<void> {
    const fn = byId.get(run.functionKey);
    if (!fn) {
      await store.releaseRun(options.pool, run.id, owner);
      return;
    }
    // Hold the lease through a long step, not only at step boundaries.
    const heartbeat = setInterval(() => {
      void store.renewLease(options.pool, run.id, owner, leaseMs).catch(() => {});
    }, Math.max(1_000, Math.floor(leaseMs / 3)));
    try {
      const outcome = await executeRun(options.pool, fn, run, { owner, leaseMs });
      options.onOutcome?.(fn.id, outcome);
    } catch (error) {
      // An engine error (not a handler error): leave the run to lease recovery.
      console.error("[jobs/postgres] executing %s run %s failed: %s", fn.id, run.id, getErrorMessage(error));
    } finally {
      clearInterval(heartbeat);
    }
  }

  async function pumpOnce(): Promise<number> {
    while ((await store.fanOutEvents(options.pool, targets)) > 0) { /* drain the event backlog */ }
    const room = concurrency - inFlight.size;
    if (room <= 0) return 0;
    const claimed = await store.claimRuns(options.pool, { owner, leaseMs, limit: room, lanes, functionIds });
    for (const run of claimed) {
      const task: Promise<void> = execute(run).finally(() => {
        inFlight.delete(task);
        if (running) wake();
      });
      inFlight.add(task);
    }
    return claimed.length;
  }

  async function pump(): Promise<void> {
    if (pumping) {
      pumpAgain = true;
      return;
    }
    pumping = true;
    try {
      do {
        pumpAgain = false;
        await pumpOnce();
      } while (pumpAgain && running);
    } catch (error) {
      console.error("[jobs/postgres] worker pass failed: %s", getErrorMessage(error));
    } finally {
      pumping = false;
    }
  }

  function wake(): void {
    if (wakeTimer) return;
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      void pump();
    }, 0);
  }

  async function maintain(): Promise<void> {
    await store.recoverExpiredLeases(options.pool);
    await store.expireWaits(options.pool);
    if (schedules.size > 0) await store.tickCrons(options.pool, schedules);
    if (Date.now() - lastPrune > 60 * 60_000) {
      lastPrune = Date.now();
      await store.pruneFinished(options.pool, new Date(Date.now() - retentionMs));
    }
  }

  return {
    owner,
    async start() {
      if (running) return;
      running = true;
      try {
        listener = await options.pool.connect();
        listener.on("notification", () => wake());
        await listener.query(`LISTEN ${store.JOBS_NOTIFY_CHANNEL}`);
      } catch (error) {
        listener?.release();
        listener = null;
        console.warn("[jobs/postgres] LISTEN unavailable; polling only: %s", getErrorMessage(error));
      }
      pollTimer = setInterval(wake, pollMs);
      maintenanceTimer = setInterval(() => {
        void maintain().then(wake, (error: unknown) =>
          console.error("[jobs/postgres] maintenance failed: %s", getErrorMessage(error)));
      }, maintenanceMs);
      await maintain().catch(() => {});
      wake();
    },
    async stop() {
      running = false;
      if (wakeTimer) clearTimeout(wakeTimer);
      if (pollTimer) clearInterval(pollTimer);
      if (maintenanceTimer) clearInterval(maintenanceTimer);
      wakeTimer = pollTimer = maintenanceTimer = null;
      if (listener) {
        await listener.query(`UNLISTEN ${store.JOBS_NOTIFY_CHANNEL}`).catch(() => {});
        listener.release();
        listener = null;
      }
      await Promise.allSettled([...inFlight]);
    },
    async drain() {
      let total = 0;
      for (;;) {
        const claimed = await pumpOnce();
        await Promise.allSettled([...inFlight]);
        total += claimed;
        if (claimed === 0) return total;
      }
    },
    maintain,
  };
}
