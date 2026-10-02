/**
 * SQL for the owned durable-job engine (spec 2026-09-25 §5.3, BI-85E6EF14).
 *
 * Every state change is one statement or one transaction on the platform
 * Postgres. Rows written here are engine state only; nothing outside
 * lib/jobs/postgres reads them.
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";

import { computeNextCronFire } from "@/lib/operate/cron-next-run";
import { JOB_CRON_EVENT_NAME, type JobReceivedEvent } from "../types";
import { evaluateCondition, readPath } from "./expressions";
import type { Lane } from "./lanes";

export const JOBS_NOTIFY_CHANNEL = "dpf_jobs";

/** A Date as UTC wall-clock text for a `timestamp without time zone` column (see pool.ts). */
export function utc(date: Date | number): string {
  return new Date(date).toISOString().replace("T", " ").replace("Z", "");
}

export type JobRunRow = {
  id: string;
  functionKey: string;
  eventId: string;
  event: JobReceivedEvent;
  status: string;
  attempt: number;
  maxAttempts: number;
};

export type FanOutTarget = {
  functionKey: string;
  maxAttempts: number;
  eventNames: readonly string[];
  cancelOn: readonly { event: string; match: string }[];
};

type EventRow = { id: string; name: string; data: Record<string, unknown>; ts: Date; receivedAt: Date };

export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function toReceivedEvent(row: Pick<EventRow, "id" | "name" | "data" | "ts">): JobReceivedEvent {
  return { id: row.id, name: row.name, data: row.data ?? {}, ts: new Date(row.ts).getTime() };
}

// ─── Send ──────────────────────────────────────────────────────────────────

export type OutgoingEvent = { id?: string; name: string; data?: Record<string, unknown>; ts?: number };

/**
 * Record events and wake the worker. A repeated id is a no-op (send-side
 * dedupe); the id is returned either way, as Inngest returns it.
 */
export async function insertEvents(pool: Pool, events: readonly OutgoingEvent[]): Promise<string[]> {
  if (events.length === 0) return [];
  const ids = events.map((event) => event.id ?? `evt_${randomUUID()}`);
  await withTransaction(pool, async (client) => {
    for (const [index, event] of events.entries()) {
      await client.query(
        `INSERT INTO "JobEvent" (id, name, data, ts) VALUES ($1, $2, $3::jsonb, $4)
         ON CONFLICT (id) DO NOTHING`,
        [ids[index], event.name, JSON.stringify(event.data ?? {}), utc(event.ts ?? Date.now())],
      );
    }
    await client.query("SELECT pg_notify($1, 'event')", [JOBS_NOTIFY_CHANNEL]);
  });
  return ids;
}

// ─── Fan-out ───────────────────────────────────────────────────────────────

/**
 * Turn received events into runs, cancellations and resolved waits, in
 * arrival order. Returns how many events were processed.
 *
 * A wait only matches events received after it was created, and a cancel only
 * reaches runs that exist when the cancel event is processed, as in Inngest.
 */
export async function fanOutEvents(pool: Pool, targets: readonly FanOutTarget[], limit = 100): Promise<number> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<EventRow>(
      `SELECT id, name, data, ts, "receivedAt" FROM "JobEvent"
       WHERE "fannedOutAt" IS NULL ORDER BY "receivedAt", id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    for (const row of rows) {
      const event = toReceivedEvent(row);
      for (const target of targets) {
        if (target.eventNames.includes(row.name)) {
          await client.query(
            `INSERT INTO "JobRun" (id, "functionKey", "eventId", event, "maxAttempts", "runAfter", "updatedAt")
             VALUES ($1, $2, $3, $4::jsonb, $5, now(), now()) ON CONFLICT ("functionKey", "eventId") DO NOTHING`,
            [`run_${randomUUID()}`, target.functionKey, row.id, JSON.stringify(event), target.maxAttempts],
          );
        }
        for (const cancel of target.cancelOn) {
          if (cancel.event !== row.name) continue;
          const value = readPath(event, cancel.match);
          if (value === undefined) continue;
          const runs = await client.query<{ id: string }>(
            `UPDATE "JobRun" SET status = 'cancelled', "finishedAt" = now(), "updatedAt" = now(), "leaseOwner" = NULL, "leaseExpiresAt" = NULL
             WHERE "functionKey" = $1 AND status IN ('queued', 'running', 'sleeping', 'waiting')
               AND (event #> $2::text[]) = $3::jsonb AND "createdAt" <= $4
             RETURNING id`,
            [target.functionKey, cancel.match.split("."), JSON.stringify(value), utc(row.receivedAt)],
          );
          await releaseRunResources(client, runs.rows.map((run) => run.id));
        }
      }
      await resolveWaits(client, row, event);
      await client.query(`UPDATE "JobEvent" SET "fannedOutAt" = now() WHERE id = $1`, [row.id]);
    }
    return rows.length;
  });
}

async function resolveWaits(client: PoolClient, row: EventRow, event: JobReceivedEvent): Promise<void> {
  const { rows } = await client.query<{ id: string; runId: string; stepKey: string; matchExpr: string | null; runEvent: JobReceivedEvent }>(
    `SELECT w.id, w."runId", w."stepKey", w."matchExpr", r.event AS "runEvent"
     FROM "JobWait" w JOIN "JobRun" r ON r.id = w."runId"
     WHERE w."eventName" = $1 AND w."createdAt" <= $2 AND w."expiresAt" > now() AND r.status = 'waiting'
     FOR UPDATE OF w SKIP LOCKED`,
    [row.name, utc(row.receivedAt)],
  );
  for (const wait of rows) {
    let matched = true;
    if (wait.matchExpr) {
      try {
        matched = evaluateCondition(wait.matchExpr, { event: wait.runEvent, async: event });
      } catch {
        matched = false;
      }
    }
    if (!matched) continue;
    await settleWait(client, wait, event);
  }
}

async function settleWait(client: PoolClient, wait: { id: string; runId: string; stepKey: string }, output: unknown): Promise<void> {
  await client.query(
    `INSERT INTO "JobStep" ("runId", "stepKey", output) VALUES ($1, $2, $3::jsonb) ON CONFLICT DO NOTHING`,
    [wait.runId, wait.stepKey, JSON.stringify(output)],
  );
  await client.query(`DELETE FROM "JobWait" WHERE id = $1`, [wait.id]);
  await client.query(
    `UPDATE "JobRun" SET status = 'queued', "runAfter" = now(), "updatedAt" = now() WHERE id = $1 AND status = 'waiting'`,
    [wait.runId],
  );
}

// ─── Claim ─────────────────────────────────────────────────────────────────

export type ClaimOptions = {
  owner: string;
  leaseMs: number;
  limit: number;
  /** Lanes for a candidate run; throwing excludes the run from this claim. */
  lanes: (run: JobRunRow) => Lane[];
  functionIds: readonly string[];
};

/**
 * Claim up to `limit` due runs, each only if every one of its concurrency
 * lanes has a free slot below its limit.
 *
 * Candidates are row-locked with SKIP LOCKED, so claimers never wait on each
 * other's rows. Each lane is guarded by a transaction-scoped advisory lock;
 * all the lanes of all candidates are locked up front in one sorted order, so
 * two claimers cannot deadlock. The (laneKey, slot) primary key is the
 * backstop: two claimers can never hold the same slot.
 */
export async function claimRuns(pool: Pool, options: ClaimOptions): Promise<JobRunRow[]> {
  if (options.functionIds.length === 0 || options.limit < 1) return [];
  return withTransaction(pool, async (client) => {
    const { rows: candidates } = await client.query<JobRunRow>(
      `SELECT id, "functionKey", "eventId", event, status, attempt, "maxAttempts" FROM "JobRun"
       WHERE status IN ('queued', 'sleeping') AND "runAfter" <= now() AND "functionKey" = ANY($1)
       ORDER BY "runAfter", id LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [options.functionIds, Math.max(options.limit * 4, 16)],
    );
    const lanesByRun = new Map<string, Lane[]>();
    for (const run of candidates) {
      try {
        lanesByRun.set(run.id, options.lanes(run));
      } catch {
        // An unevaluable key keeps the run queued and visible rather than run unbounded.
      }
    }
    const lockKeys = [...new Set([...lanesByRun.values()].flat().map((lane) => lane.key))].sort();
    for (const key of lockKeys) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [key]);
    }
    const claimed: JobRunRow[] = [];
    for (const run of candidates) {
      if (claimed.length >= options.limit) break;
      const lanes = lanesByRun.get(run.id);
      if (!lanes) continue;
      const slots: Array<{ key: string; slot: number }> = [];
      for (const lane of lanes) {
        const { rows } = await client.query<{ slot: number }>(
          `SELECT slot FROM "JobConcurrencySlot" WHERE "laneKey" = $1`,
          [lane.key],
        );
        const held = new Set(rows.map((row) => row.slot));
        let free = -1;
        for (let slot = 0; slot < lane.limit; slot++) {
          if (!held.has(slot)) {
            free = slot;
            break;
          }
        }
        if (free < 0) break;
        slots.push({ key: lane.key, slot: free });
      }
      if (slots.length !== lanes.length) continue;
      for (const slot of slots) {
        await client.query(
          `INSERT INTO "JobConcurrencySlot" ("laneKey", slot, "runId") VALUES ($1, $2, $3)`,
          [slot.key, slot.slot, run.id],
        );
      }
      await client.query(
        `UPDATE "JobRun" SET status = 'running', "leaseOwner" = $2, "leaseExpiresAt" = now() + ($3 || ' milliseconds')::interval, "updatedAt" = now()
         WHERE id = $1`,
        [run.id, options.owner, String(options.leaseMs)],
      );
      claimed.push({ ...run, status: "running" });
    }
    return claimed;
  });
}

async function releaseRunResources(client: Pool | PoolClient, runIds: readonly string[]): Promise<void> {
  if (runIds.length === 0) return;
  await client.query(`DELETE FROM "JobConcurrencySlot" WHERE "runId" = ANY($1)`, [runIds]);
  await client.query(`DELETE FROM "JobWait" WHERE "runId" = ANY($1)`, [runIds]);
}

// ─── Steps ─────────────────────────────────────────────────────────────────

export async function loadSteps(pool: Pool, runId: string): Promise<Map<string, unknown>> {
  const { rows } = await pool.query<{ stepKey: string; output: unknown }>(
    `SELECT "stepKey", output FROM "JobStep" WHERE "runId" = $1`,
    [runId],
  );
  return new Map(rows.map((row) => [row.stepKey, row.output]));
}

/** Record a step's output. The first write wins, so a replay never overwrites history. */
export async function saveStep(pool: Pool, runId: string, stepKey: string, output: unknown): Promise<unknown> {
  const { rows } = await pool.query<{ output: unknown }>(
    `INSERT INTO "JobStep" ("runId", "stepKey", output) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT ("runId", "stepKey") DO UPDATE SET "runId" = EXCLUDED."runId"
     RETURNING output`,
    [runId, stepKey, JSON.stringify(output)],
  );
  return rows[0]?.output ?? null;
}

/**
 * Extend the lease of a run this worker holds. Returns false when the run is
 * no longer this worker's to execute (cancelled, or its lease was recovered).
 */
export async function renewLease(pool: Pool, runId: string, owner: string, leaseMs: number): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE "JobRun" SET "leaseExpiresAt" = now() + ($3 || ' milliseconds')::interval, "updatedAt" = now()
     WHERE id = $1 AND "leaseOwner" = $2 AND status = 'running'`,
    [runId, owner, String(leaseMs)],
  );
  return (rowCount ?? 0) > 0;
}

// ─── Run transitions (each guarded by the lease owner) ─────────────────────

async function transition(
  pool: Pool,
  runId: string,
  owner: string,
  set: string,
  params: unknown[],
  extra?: (client: PoolClient) => Promise<void>,
): Promise<boolean> {
  return withTransaction(pool, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE "JobRun" SET ${set}, "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = now()
       WHERE id = $1 AND "leaseOwner" = $2 AND status = 'running'`,
      [runId, owner, ...params],
    );
    if (!rowCount) return false;
    await client.query(`DELETE FROM "JobConcurrencySlot" WHERE "runId" = $1`, [runId]);
    if (extra) await extra(client);
    return true;
  });
}

export function completeRun(pool: Pool, runId: string, owner: string, output: unknown): Promise<boolean> {
  return transition(pool, runId, owner, `status = 'completed', output = $3::jsonb, "finishedAt" = now()`, [JSON.stringify(output ?? null)]);
}

export function failRun(pool: Pool, runId: string, owner: string, error: string): Promise<boolean> {
  return transition(pool, runId, owner, `status = 'failed', error = $3, attempt = attempt + 1, "finishedAt" = now()`, [error]);
}

export function retryRun(pool: Pool, runId: string, owner: string, error: string, runAfter: Date): Promise<boolean> {
  return transition(pool, runId, owner, `status = 'queued', error = $3, attempt = attempt + 1, "runAfter" = $4`, [error, utc(runAfter)]);
}

/** Park on step.sleep: the step is recorded now, so the replay after waking passes it. */
export function parkSleep(pool: Pool, runId: string, owner: string, stepKey: string, wakeAt: Date): Promise<boolean> {
  return transition(pool, runId, owner, `status = 'sleeping', "runAfter" = $3`, [utc(wakeAt)], async (client) => {
    await client.query(
      `INSERT INTO "JobStep" ("runId", "stepKey", output) VALUES ($1, $2, 'null'::jsonb) ON CONFLICT DO NOTHING`,
      [runId, stepKey],
    );
  });
}

/** Park on step.waitForEvent until a matching event or the timeout. */
export function parkWait(
  pool: Pool,
  runId: string,
  owner: string,
  wait: { stepKey: string; eventName: string; matchExpr: string | null; expiresAt: Date },
): Promise<boolean> {
  return transition(pool, runId, owner, `status = 'waiting'`, [], async (client) => {
    await client.query(
      `INSERT INTO "JobWait" (id, "runId", "stepKey", "eventName", "matchExpr", "expiresAt")
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT ("runId", "stepKey") DO NOTHING`,
      [`wait_${randomUUID()}`, runId, wait.stepKey, wait.eventName, wait.matchExpr, utc(wait.expiresAt)],
    );
  });
}

/** Give up a claimed run without counting an attempt (the worker is shutting down). */
export function releaseRun(pool: Pool, runId: string, owner: string): Promise<boolean> {
  return transition(pool, runId, owner, `status = 'queued', "runAfter" = now()`, []);
}

// ─── Maintenance ───────────────────────────────────────────────────────────

/** A run whose lease expired goes back to the queue; its slots are freed. */
export async function recoverExpiredLeases(pool: Pool): Promise<number> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `UPDATE "JobRun" SET status = 'queued', "runAfter" = now(), "leaseOwner" = NULL, "leaseExpiresAt" = NULL, "updatedAt" = now()
       WHERE status = 'running' AND "leaseExpiresAt" < now() RETURNING id`,
    );
    await releaseRunResources(client, rows.map((row) => row.id));
    return rows.length;
  });
}

/** A wait that timed out resumes its run with a `null` result, as in Inngest. */
export async function expireWaits(pool: Pool): Promise<number> {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ id: string; runId: string; stepKey: string }>(
      `SELECT id, "runId", "stepKey" FROM "JobWait" WHERE "expiresAt" <= now() FOR UPDATE SKIP LOCKED LIMIT 500`,
    );
    for (const wait of rows) await settleWait(client, wait, null);
    return rows.length;
  });
}

/**
 * Fire due cron schedules once each. A schedule that missed several fire
 * times fires once and moves to its next time after now (no backfill, as in
 * Inngest). The cron event id is the schedule slot, so two workers can never
 * start the same fire twice.
 */
export type CronSchedule = { crons: readonly string[]; maxAttempts: number };

export async function tickCrons(pool: Pool, schedules: ReadonlyMap<string, CronSchedule>): Promise<number> {
  const now = new Date();
  for (const [functionKey, { crons }] of schedules) {
    const cron = crons.join(" | ");
    const next = earliestFire(crons, now);
    if (!next) continue;
    await pool.query(
      `INSERT INTO "JobCronState" ("functionKey", cron, "nextFireAt", "updatedAt") VALUES ($1, $2, $3, now())
       ON CONFLICT ("functionKey") DO UPDATE SET cron = EXCLUDED.cron, "nextFireAt" = EXCLUDED."nextFireAt", "updatedAt" = now()
       WHERE "JobCronState".cron <> EXCLUDED.cron`,
      [functionKey, cron, utc(next)],
    );
  }
  const ids = [...schedules.keys()];
  if (ids.length === 0) return 0;
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query<{ functionKey: string; cron: string; nextFireAt: Date }>(
      `SELECT "functionKey", cron, "nextFireAt" FROM "JobCronState"
       WHERE "nextFireAt" <= now() AND "functionKey" = ANY($1) FOR UPDATE SKIP LOCKED`,
      [ids],
    );
    for (const row of rows) {
      const schedule = schedules.get(row.functionKey);
      if (!schedule) continue;
      const fireAt = new Date(row.nextFireAt);
      const eventId = `cron:${row.functionKey}:${fireAt.toISOString()}`;
      const event: JobReceivedEvent = { id: eventId, name: JOB_CRON_EVENT_NAME, data: { cron: row.cron }, ts: fireAt.getTime() };
      await client.query(
        `INSERT INTO "JobEvent" (id, name, data, ts, "fannedOutAt") VALUES ($1, $2, $3::jsonb, $4, now()) ON CONFLICT (id) DO NOTHING`,
        [eventId, JOB_CRON_EVENT_NAME, JSON.stringify(event.data), utc(fireAt)],
      );
      await client.query(
        `INSERT INTO "JobRun" (id, "functionKey", "eventId", event, "maxAttempts", "runAfter", "updatedAt")
         VALUES ($1, $2, $3, $4::jsonb, $5, now(), now()) ON CONFLICT ("functionKey", "eventId") DO NOTHING`,
        [`run_${randomUUID()}`, row.functionKey, eventId, JSON.stringify(event), schedule.maxAttempts],
      );
      const next = earliestFire(schedule.crons, new Date());
      await client.query(
        `UPDATE "JobCronState" SET "nextFireAt" = $2, "updatedAt" = now() WHERE "functionKey" = $1`,
        [row.functionKey, utc(next ?? Date.now() + 86_400_000)],
      );
    }
    if (rows.length > 0) await client.query("SELECT pg_notify($1, 'cron')", [JOBS_NOTIFY_CHANNEL]);
    return rows.length;
  });
}

function earliestFire(crons: readonly string[], from: Date): Date | null {
  const fires = crons.map((cron) => computeNextCronFire(cron, from)).filter((d): d is Date => d !== null);
  return fires.length ? new Date(Math.min(...fires.map((d) => d.getTime()))) : null;
}

/**
 * The engine's retention: finished runs older than the cutoff (their steps,
 * waits and slots cascade) and events no unfinished run still points to.
 */
export async function pruneFinished(pool: Pool, olderThan: Date, batch = 1_000): Promise<{ runs: number; events: number }> {
  const runs = await pool.query(
    `DELETE FROM "JobRun" WHERE id IN (
       SELECT id FROM "JobRun" WHERE status IN ('completed', 'failed', 'cancelled') AND "finishedAt" < $1 LIMIT $2)`,
    [utc(olderThan), batch],
  );
  const events = await pool.query(
    `DELETE FROM "JobEvent" e WHERE e.id IN (
       SELECT id FROM "JobEvent" WHERE "fannedOutAt" IS NOT NULL AND "receivedAt" < $1 LIMIT $2)
     AND NOT EXISTS (SELECT 1 FROM "JobRun" r WHERE r."eventId" = e.id)`,
    [utc(olderThan), batch],
  );
  return { runs: runs.rowCount ?? 0, events: events.rowCount ?? 0 };
}
