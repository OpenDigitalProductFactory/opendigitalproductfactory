// EP-DATA-RETENTION — Data retention & lifecycle governance constants.
//
// Spec: docs/superpowers/specs/2026-06-14-data-retention-lifecycle-governance-design.md
//
// The scheduled-job identifiers are duplicated (intentionally — packages/db
// cannot import from apps/web) in packages/db/src/seed-platform-retention.ts.
// If you change one, change both, or the ScheduledJob heartbeat row will be
// orphaned. This mirrors the postgres-backup constants convention.

export const DATA_RETENTION_JOB_ID = "data-retention-sweep";
export const DATA_RETENTION_JOB_NAME =
  "Data retention sweep (platform-managed)";
export const DATA_RETENTION_SCHEDULE = "daily";

/** Inngest function ids. */
export const DATA_RETENTION_SCHEDULED_INNGEST_ID =
  "ops/data-retention-sweep-scheduled";
export const DATA_RETENTION_REQUESTED_INNGEST_ID =
  "ops/data-retention-sweep-requested";

/** Event that triggers a one-shot manual run (operator "run now" / dry-run). */
export const DATA_RETENTION_REQUESTED_EVENT = "ops/data-retention.requested";

/** Runs at 04:00 UTC — strictly AFTER the 03:00 backup crons, so a durable
 *  backup always exists before any row is purged. Do not move earlier. */
export const DATA_RETENTION_CRON = "0 4 * * *";

const MS_PER_DAY = 86_400_000;

/** Rows fetched + deleted per batch. Keeps each DELETE small so a nightly
 *  sweep never takes a long lock on a hot table. */
export const RETENTION_BATCH_SIZE = 1_000;

/** Upper bound on rows purged per policy per run. A fresh install with years
 *  of accumulated logs catches up over several nights rather than issuing one
 *  enormous delete. `capped: true` in the report flags a policy that hit it. */
export const RETENTION_PER_POLICY_CAP = 100_000;

// ── Named retention windows (days) ──────────────────────────────────────────
// Conservative defaults. Industry floors (industry-floors.ts) may LENGTHEN
// these; nothing shortens them. See the spec's retention matrix for rationale.
export const DAYS_30 = 30;
export const DAYS_90 = 90;
export const DAYS_180 = 180;
export const DAYS_365 = 365;
export const DAYS_545 = 545; // ~18 months
/** 7 years — the common statutory floor for financial / tax records. */
export const YEARS_7_IN_DAYS = 2_555;
/** 6 years — common HIPAA-adjacent clinical record floor. */
export const YEARS_6_IN_DAYS = 2_190;
/** 3 years — common public-records / general operational audit floor. */
export const YEARS_3_IN_DAYS = 1_095;

/** Returns `now - days` as the purge cutoff: rows strictly older are eligible. */
export function cutoffForDays(days: number, now: Date): Date {
  return new Date(now.getTime() - days * MS_PER_DAY);
}

/** Next 04:00 UTC strictly after `from` (mirrors the backup seed helper). */
export function nextRetentionRunAt(from: Date): Date {
  const next = new Date(from);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(0);
  next.setUTCHours(4);
  if (next <= from) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}
