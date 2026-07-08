// BI-0AB96FE7 — Pure Inngest-retention engine.
//
// Testable in isolation: everything the sweep does is expressed against an
// injected `SqlRunner`, so unit tests assert the reap/trim behavior with a fake
// runner and no live database. run.ts wires the real `pg` client (db=inngest)
// and the operator kill switch around this.
//
// Design notes on the Inngest schema (verified against the live db=inngest):
//   • run_id is encoded DIFFERENTLY per table — bytea in function_runs /
//     function_finishes / history, text in spans, char(26) in trace_runs /
//     traces. So we NEVER cross-join on run_id; every table is trimmed by its
//     OWN timestamp column. This is both correct and lock-friendly.
//   • Orphans (the executor-wedge root cause) live in function_runs: an
//     UNFINISHED row older than the Redis-TTL ceiling. Reaping those rows stops
//     the executor's infinite retry.
//   • Table/column names below are compile-time constants from this module's
//     own allowlist — never caller input — so interpolating them into SQL
//     carries no injection surface; the time cutoff is always a bound param.

import {
  ORPHAN_REAP_AGE_HOURS,
  INNGEST_HISTORY_RETENTION_DAYS,
  INNGEST_RETENTION_BATCH_SIZE,
  INNGEST_RETENTION_PER_TABLE_CAP,
  cutoffForHours,
  cutoffForDays,
} from "./constants";
import { getErrorMessage } from "@/lib/shared/get-error-message";

export interface SqlResult {
  rowCount: number | null;
  rows: Array<Record<string, unknown>>;
}

/** Minimal surface of a `pg` client the engine needs. */
export interface SqlRunner {
  query(text: string, params?: unknown[]): Promise<SqlResult>;
}

export interface InngestRetentionSweepReport {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Unfinished, Redis-orphaned function_runs removed (the wedge fix). */
  orphansReaped: number;
  /** Aged bookkeeping rows removed across all history tables. */
  historyTrimmed: number;
  /** Per-table removal counts (includes the `function_runs` orphan reap). */
  byTable: Record<string, number>;
  /** Tables that hit INNGEST_RETENTION_PER_TABLE_CAP this run (more remains). */
  capped: string[];
  errorCount: number;
  errors: Array<{ table: string; error: string }>;
}

type TimeKind = "timestamp" | "unix_ms";

interface HistoryTable {
  table: string;
  column: string;
  kind: TimeKind;
  /** Extra predicate ANDed with the age filter (constant SQL, no params). */
  extra?: string;
}

// Aged-history trim targets. `function_runs` is restricted to FINISHED rows so
// the partition with the orphan reap is clean (unfinished → reap at 24h;
// finished → trim at the history window). `trace_runs.ended_at` is unix-ms and
// 0 for a still-running trace, so it is guarded > 0.
const HISTORY_TABLES: readonly HistoryTable[] = [
  {
    table: "function_runs",
    column: "run_started_at",
    kind: "timestamp",
    extra:
      "EXISTS (SELECT 1 FROM function_finishes f WHERE f.run_id = function_runs.run_id)",
  },
  { table: "function_finishes", column: "created_at", kind: "timestamp" },
  { table: "spans", column: "start_time", kind: "timestamp" },
  { table: "history", column: "created_at", kind: "timestamp" },
  { table: "traces", column: "timestamp", kind: "timestamp" },
  { table: "trace_runs", column: "ended_at", kind: "unix_ms", extra: "ended_at > 0" },
];

/** The orphan predicate: unfinished function_runs older than the cutoff. */
const ORPHAN_PREDICATE =
  "run_started_at < $1 AND NOT EXISTS " +
  "(SELECT 1 FROM function_finishes f WHERE f.run_id = function_runs.run_id)";

function agePredicate(t: HistoryTable): string {
  const age = `${t.column} < $1`;
  return t.extra ? `${age} AND ${t.extra}` : age;
}

/** Bound value for a table's age predicate: a Date for timestamp columns, a
 *  unix-ms number for bigint columns. */
function ageBound(kind: TimeKind, cutoff: Date): Date | number {
  return kind === "unix_ms" ? cutoff.getTime() : cutoff;
}

async function countEligible(
  sql: SqlRunner,
  table: string,
  predicate: string,
  bound: Date | number,
): Promise<number> {
  const res = await sql.query(
    `SELECT count(*)::int AS c FROM ${table} WHERE ${predicate}`,
    [bound],
  );
  const c = res.rows[0]?.c;
  return typeof c === "number" ? c : Number(c ?? 0);
}

/**
 * Batched delete: repeatedly removes up to `batchSize` matching rows (selected
 * by ctid so the LIMIT is honored) until a batch comes back short or the
 * per-table cap is reached. Returns `{ deleted, capped }`.
 */
async function deleteBatched(
  sql: SqlRunner,
  table: string,
  predicate: string,
  bound: Date | number,
  batchSize: number,
  cap: number,
): Promise<{ deleted: number; capped: boolean }> {
  let deleted = 0;
  for (;;) {
    const remaining = cap - deleted;
    if (remaining <= 0) return { deleted, capped: true };
    const limit = Math.min(batchSize, remaining);
    const res = await sql.query(
      `DELETE FROM ${table} WHERE ctid IN ` +
        `(SELECT ctid FROM ${table} WHERE ${predicate} LIMIT ${limit})`,
      [bound],
    );
    const n = res.rowCount ?? 0;
    deleted += n;
    if (n < limit) return { deleted, capped: false };
  }
}

/**
 * Reap orphans, then trim aged history. Best-effort per table: a failure on one
 * table is recorded and the sweep continues, so a single bad table can never
 * abort the whole janitor (and re-wedge the executor). In dryRun mode nothing
 * is deleted — each target is COUNTED instead, so the operator preview shows
 * exactly what a real run would remove.
 */
export async function runInngestRetentionSweep(opts: {
  sql: SqlRunner;
  now: Date;
  dryRun: boolean;
  orphanAgeHours?: number;
  retentionDays?: number;
  batchSize?: number;
  perTableCap?: number;
}): Promise<InngestRetentionSweepReport> {
  const {
    sql,
    now,
    dryRun,
    orphanAgeHours = ORPHAN_REAP_AGE_HOURS,
    retentionDays = INNGEST_HISTORY_RETENTION_DAYS,
    batchSize = INNGEST_RETENTION_BATCH_SIZE,
    perTableCap = INNGEST_RETENTION_PER_TABLE_CAP,
  } = opts;

  const startedAt = now;
  const orphanCutoff = cutoffForHours(orphanAgeHours, now);
  const historyCutoff = cutoffForDays(retentionDays, now);

  const byTable: Record<string, number> = {};
  const capped: string[] = [];
  const errors: Array<{ table: string; error: string }> = [];
  let orphansReaped = 0;
  let historyTrimmed = 0;

  // 1) Orphan reap — the executor-wedge fix. Runs first and unconditionally.
  try {
    if (dryRun) {
      orphansReaped = await countEligible(
        sql,
        "function_runs",
        ORPHAN_PREDICATE,
        orphanCutoff,
      );
    } else {
      const r = await deleteBatched(
        sql,
        "function_runs",
        ORPHAN_PREDICATE,
        orphanCutoff,
        batchSize,
        perTableCap,
      );
      orphansReaped = r.deleted;
      if (r.capped) capped.push("function_runs:orphans");
    }
    byTable["function_runs:orphans"] = orphansReaped;
  } catch (err) {
    errors.push({
      table: "function_runs:orphans",
      error: getErrorMessage(err),
    });
  }

  // 2) Aged-history trim, per table by its own timestamp.
  for (const t of HISTORY_TABLES) {
    const predicate = agePredicate(t);
    const bound = ageBound(t.kind, historyCutoff);
    try {
      let removed: number;
      if (dryRun) {
        removed = await countEligible(sql, t.table, predicate, bound);
      } else {
        const r = await deleteBatched(
          sql,
          t.table,
          predicate,
          bound,
          batchSize,
          perTableCap,
        );
        removed = r.deleted;
        if (r.capped) capped.push(t.table);
      }
      byTable[t.table] = (byTable[t.table] ?? 0) + removed;
      historyTrimmed += removed;
    } catch (err) {
      errors.push({
        table: t.table,
        error: getErrorMessage(err),
      });
    }
  }

  const finishedAt = new Date();
  return {
    dryRun,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    orphansReaped,
    historyTrimmed,
    byTable,
    capped,
    errorCount: errors.length,
    errors,
  };
}
