/**
 * GFS (Grandfather-Father-Son) retention math for platform-managed backups.
 *
 * Spec: docs/superpowers/specs/2026-05-17-postgres-daily-backup-design.md §4.5
 *
 * Pure function — no Prisma, no filesystem. The orchestrator passes in the
 * candidate runs, this returns the partition. Easy to unit-test in isolation.
 */

import type { BackupRetentionPolicy } from "./types";

/**
 * Minimal subset of a BackupRun we need for retention decisions. Keeping this
 * narrow lets the caller stub it freely in tests and avoids coupling to the
 * Prisma type.
 */
export interface RetainableRun {
  id: string;
  status: string;
  finishedAt: Date | null;
  startedAt: Date;
  prunedAt: Date | null;
}

export interface RetentionPartition<T extends RetainableRun> {
  keep: T[];
  prune: T[];
}

/** ISO-week key (Monday-anchored) of the given date in UTC: "YYYY-Www". */
function isoWeekKey(d: Date): string {
  // Algorithm from Postgres ISO 8601: shift to Thursday of the same week,
  // then compute week-of-year.
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (tmp.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  tmp.setUTCDate(tmp.getUTCDate() - dayNum + 3); // Thursday of this week
  const firstThursday = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  const week =
    1 +
    Math.round(
      (tmp.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000),
    );
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Calendar-month key in UTC: "YYYY-MM". */
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Apply GFS retention. Failed runs and already-pruned runs are excluded from
 * the keep set entirely (a failed dump is not a candidate to retain — its row
 * stays in the DB for audit but the file is either absent or untrusted).
 *
 * Algorithm:
 *   1. Successful, not-yet-pruned runs are sorted descending by finishedAt.
 *   2. The N most recent become the daily keep set.
 *   3. Walking older→newer, take the most recent successful run per ISO week
 *      until we have `weekly` weekly entries.
 *   4. Same for calendar months until we have `monthly` monthly entries.
 *   5. Union of (daily ∪ weekly ∪ monthly) = keep; complement = prune.
 *
 * Note: any failed or already-pruned run is left in `prune` so the caller's
 * disk cleanup is a no-op for them (their files are already gone or never
 * existed). They stay in the DB for audit.
 */
export function partitionForRetention<T extends RetainableRun>(
  runs: T[],
  policy: BackupRetentionPolicy,
): RetentionPartition<T> {
  const ineligible = runs.filter(
    (r) => r.status !== "ok" || r.prunedAt !== null || r.finishedAt === null,
  );

  const eligible = runs
    .filter(
      (r) => r.status === "ok" && r.prunedAt === null && r.finishedAt !== null,
    )
    .sort((a, b) => b.finishedAt!.getTime() - a.finishedAt!.getTime());

  const keepIds = new Set<string>();

  // Daily bucket: top N by finishedAt.
  for (let i = 0; i < Math.min(policy.daily, eligible.length); i++) {
    keepIds.add(eligible[i]!.id);
  }

  // Weekly bucket: one per ISO week, most-recent-wins.
  const weeklyPicked = new Map<string, T>();
  for (const r of eligible) {
    const key = isoWeekKey(r.finishedAt!);
    if (!weeklyPicked.has(key)) {
      weeklyPicked.set(key, r);
      if (weeklyPicked.size >= policy.weekly) break;
    }
  }
  for (const r of weeklyPicked.values()) keepIds.add(r.id);

  // Monthly bucket: one per calendar month, most-recent-wins.
  const monthlyPicked = new Map<string, T>();
  for (const r of eligible) {
    const key = monthKey(r.finishedAt!);
    if (!monthlyPicked.has(key)) {
      monthlyPicked.set(key, r);
      if (monthlyPicked.size >= policy.monthly) break;
    }
  }
  for (const r of monthlyPicked.values()) keepIds.add(r.id);

  const keep: T[] = [];
  const prune: T[] = [];
  for (const r of eligible) {
    if (keepIds.has(r.id)) keep.push(r);
    else prune.push(r);
  }
  // Ineligible runs (failed / already-pruned) — pruning is a no-op for them
  // but the caller may want to know they were considered.
  for (const r of ineligible) prune.push(r);

  return { keep, prune };
}

export { isoWeekKey, monthKey };
