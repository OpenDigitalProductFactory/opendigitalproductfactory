// BI-0AB96FE7 (EP-B9DD37C7) — Inngest history-retention + orphan-reaper janitor.
//
// Root cause (evidence-verified 2026-07-07): self-hosted Inngest v1.30 splits
// state — live run state in Redis under a ~12–16h TTL; durable history in
// Postgres db=inngest (function_runs, spans, history, …) with NO TTL and NO GC.
// A run whose Redis {estate} state TTL-expires strands its Postgres rows; the
// single executor retries the orphan forever ("run not found in state store" +
// "duplicate key spans_pkey") and the orphans accumulate unbounded (21,838
// unfinished function_runs / ~987k spans at the choke point) until the executor
// chokes and drives ZERO executions — a silent, total outage of all scheduled
// and autonomous dispatch. This janitor bounds the history and reaps the
// orphans BEFORE they can starve the executor. Non-destructive: it deletes only
// Inngest's own aged/orphaned bookkeeping rows, never application data.
//
// The scheduled-job identifiers are duplicated (intentionally — packages/db
// cannot import from apps/web) in packages/db/src/seed-platform-inngest-retention.ts.
// If you change one, change both, or the ScheduledJob heartbeat row will be
// orphaned. This mirrors the data-retention / postgres-backup constants convention.

export const INNGEST_RETENTION_JOB_ID = "inngest-retention-sweep";
export const INNGEST_RETENTION_JOB_NAME =
  "Inngest retention sweep (platform-managed)";
export const INNGEST_RETENTION_SCHEDULE = "every-6-hours";

/** Inngest function ids. */
export const INNGEST_RETENTION_SCHEDULED_INNGEST_ID =
  "ops/inngest-retention-sweep-scheduled";
export const INNGEST_RETENTION_REQUESTED_INNGEST_ID =
  "ops/inngest-retention-sweep-requested";

/** Event that triggers a one-shot manual run (operator "run now" / dry-run). */
export const INNGEST_RETENTION_REQUESTED_EVENT = "ops/inngest-retention.requested";

/** Every 6 hours at :17 past (00/06/12/18 UTC). Frequent enough that orphans
 *  never approach the choke threshold; :17 offset avoids the top-of-hour cron
 *  pileup. Widen/disable via the operator kill switch, not a code edit. */
export const INNGEST_RETENTION_CRON = "17 */6 * * *";

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const SIX_HOURS_MS = 6 * MS_PER_HOUR;

/**
 * Age past which an UNFINISHED function_runs row is a genuine orphan: its Redis
 * {estate} state has certainly TTL-expired (observed TTLs ~12–16h), so the run
 * can never complete and the executor is only retrying a corpse. 24h sits
 * comfortably above the TTL ceiling AND above any legitimate long-running
 * function (self-upgrade < 1h; quiescence waits are budget-bounded), so nothing
 * live is ever reaped.
 */
export const ORPHAN_REAP_AGE_HOURS = 24;

/** Finished/aged Inngest bookkeeping older than this is trimmed to bound the DB.
 *  Inngest history is pure operational telemetry — 7 days is ample for
 *  debugging a recent run while keeping the tables tiny. */
export const INNGEST_HISTORY_RETENTION_DAYS = 7;

/** Rows deleted per batch. Keeps each DELETE small so the sweep never takes a
 *  long lock on a hot Inngest table. */
export const INNGEST_RETENTION_BATCH_SIZE = 2_000;

/** Upper bound on rows purged per table per run. A fresh install with a huge
 *  accumulated backlog catches up over several runs rather than one enormous
 *  delete. A table that hits this is flagged `capped` in the report. */
export const INNGEST_RETENTION_PER_TABLE_CAP = 200_000;

/** Returns `now - hours`. */
export function cutoffForHours(hours: number, now: Date): Date {
  return new Date(now.getTime() - hours * MS_PER_HOUR);
}

/** Returns `now - days`. */
export function cutoffForDays(days: number, now: Date): Date {
  return new Date(now.getTime() - days * MS_PER_DAY);
}

/** Next :17 past the next 6-hour UTC boundary (00/06/12/18) strictly after
 *  `from`. The 6h grid divides the day evenly, so flooring to a 6h block aligns
 *  to UTC midnight. */
export function nextInngestRetentionRunAt(from: Date): Date {
  const blockStart = Math.floor(from.getTime() / SIX_HOURS_MS) * SIX_HOURS_MS;
  let slot = blockStart + 17 * 60_000;
  if (slot <= from.getTime()) slot += SIX_HOURS_MS;
  return new Date(slot);
}

/**
 * Resolve the connection string for the Inngest Postgres database (db=inngest).
 * Prefers an explicit INNGEST_POSTGRES_URI (present on the inngest container);
 * otherwise derives it from the portal's DATABASE_URL by swapping the database
 * name to `inngest` — the two databases live on the same server. Prisma-only
 * query params (schema, connection_limit, pgbouncer, …) are stripped so the
 * plain `pg` client is not confused. Returns null when no source is available.
 */
export function resolveInngestDatabaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicit = env.INNGEST_POSTGRES_URI?.trim();
  if (explicit) {
    return /^postgres(ql)?:\/\//.test(explicit) ? explicit : `postgresql://${explicit}`;
  }
  const base = env.DATABASE_URL?.trim();
  if (!base) return null;
  try {
    const u = new URL(base);
    u.pathname = "/inngest";
    u.search = "";
    return u.toString();
  } catch {
    return null;
  }
}
