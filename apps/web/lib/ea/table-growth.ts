// apps/web/lib/ea/table-growth.ts
//
// EP-A33A5C61 slice 5 (BI-592F1E7E) — the Data Architect steward watches
// GROWTH, not only structure.
//
// Until now the four drift detectors (fk-without-index, missing-inverse-
// relation, orphan-model, ignored-model) were purely structural: a table
// growing 55k rows a day with no retention disposition was found only by a
// human at psql. This module adds the measurement and two detectors:
//
//   • sampleTableGrowth   — one row per table per night from pg_class /
//                           pg_stat_user_tables (heap / index / TOAST split,
//                           live + dead tuples) plus rows-in-the-last-24h on the
//                           table's declared time axis (the /// @dpf timeAxis).
//   • detectGrowthDrift   — PURE. Reads the last few samples per table and the
//                           schema declarations and emits:
//       growth-without-disposition  measurable growth on a table whose
//                                   declaration is missing, or whose disposition
//                                   never removes rows (reference/config/domain/
//                                   projection are fine only while they do not
//                                   grow); carries a 12-month projection.
//       payload-anatomy             TOAST dominates the relation — a JSON/text
//                                   column is carrying blobs that belong in the
//                                   content-addressed store (see the evidence
//                                   ceiling in lib/evidence/bounded-output.ts).
//
// Findings reconcile into EaConformanceIssue like every other steward finding,
// and a finding that persists across PERSISTENT_NIGHTS consecutive samples is
// filed once as a backlog item (fingerprinted, never duplicated).

import type { ModelDeclaration } from "@/lib/operate/retention/declarations";
import type { DriftFinding } from "./data-architecture-steward";

export const GROWTH_ISSUE_TYPES = ["growth-without-disposition", "payload-anatomy"] as const;
export type GrowthIssueType = (typeof GROWTH_ISSUE_TYPES)[number];

/** A table must add at least this many rows in 24 h before growth is "measurable". */
export const GROWTH_ROWS_PER_DAY_THRESHOLD = 1_000;
/** …or this many bytes per day (from consecutive samples). */
export const GROWTH_BYTES_PER_DAY_THRESHOLD = 5 * 1024 * 1024;
/** TOAST must be at least this share of the relation, and the relation this big, to flag anatomy. */
export const TOAST_SHARE_THRESHOLD = 0.5;
export const TOAST_MIN_TOTAL_BYTES = 50 * 1024 * 1024;
/** Consecutive nightly samples a finding must persist before it files a backlog item. */
export const PERSISTENT_NIGHTS = 3;

export type TableGrowthSampleRow = {
  table: string;
  model: string | null;
  sampledAt: Date;
  totalBytes: bigint;
  heapBytes: bigint;
  indexBytes: bigint;
  toastBytes: bigint;
  liveRows: bigint;
  deadRows: bigint;
  rowsLast24h: number | null;
  declaredRetention: string | null;
};

type SamplerDb = {
  $queryRawUnsafe<T = unknown>(query: string): Promise<T>;
};

const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function retentionLabel(d: ModelDeclaration | undefined): string | null {
  if (!d) return null;
  const r = d.metadata.retention;
  return r.kind === "purge" ? `${r.days}d` : r.kind;
}

/**
 * Take one sample per table. `declarations` supplies model name, retention and
 * the time axis; untagged tables are sampled too (their disposition is null,
 * which is exactly what the detector needs to see).
 */
export async function sampleTableGrowth(
  db: SamplerDb,
  declarations: readonly ModelDeclaration[],
  now: Date = new Date(),
): Promise<TableGrowthSampleRow[]> {
  const byTable = new Map(declarations.map((d) => [d.table, d]));
  const rows = await db.$queryRawUnsafe<
    Array<{ table: string; total: bigint; heap: bigint; index: bigint; toast: bigint; live: bigint; dead: bigint }>
  >(
    `SELECT c.relname AS "table",
            pg_total_relation_size(c.oid) AS "total",
            pg_relation_size(c.oid) AS "heap",
            pg_indexes_size(c.oid) AS "index",
            (pg_total_relation_size(c.oid) - pg_relation_size(c.oid) - pg_indexes_size(c.oid)) AS "toast",
            COALESCE(s.n_live_tup, 0) AS "live",
            COALESCE(s.n_dead_tup, 0) AS "dead"
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
      WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'p')`,
  );
  const out: TableGrowthSampleRow[] = [];
  for (const r of rows) {
    const decl = byTable.get(r.table);
    let rowsLast24h: number | null = null;
    const axis = decl?.metadata.timeAxis;
    if (axis && IDENT_RE.test(axis) && IDENT_RE.test(r.table)) {
      try {
        const [{ n }] = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*) AS "n" FROM "${r.table}" WHERE "${axis}" > now() - interval '1 day'`,
        );
        rowsLast24h = Number(n);
      } catch {
        rowsLast24h = null; // a wrong axis is a declaration bug the guard reports elsewhere
      }
    }
    out.push({
      table: r.table,
      model: decl?.model ?? null,
      sampledAt: now,
      totalBytes: BigInt(r.total),
      heapBytes: BigInt(r.heap),
      indexBytes: BigInt(r.index),
      toastBytes: BigInt(r.toast),
      liveRows: BigInt(r.live),
      deadRows: BigInt(r.dead),
      rowsLast24h,
      declaredRetention: retentionLabel(decl),
    });
  }
  return out;
}

const MS_PER_DAY = 86_400_000;

/** Bytes/day from the two most recent samples of one table; null with fewer than two. */
export function bytesPerDay(samples: readonly TableGrowthSampleRow[]): number | null {
  if (samples.length < 2) return null;
  const sorted = [...samples].sort((a, b) => a.sampledAt.getTime() - b.sampledAt.getTime());
  const a = sorted[sorted.length - 2];
  const b = sorted[sorted.length - 1];
  const days = (b.sampledAt.getTime() - a.sampledAt.getTime()) / MS_PER_DAY;
  if (days <= 0) return null;
  return Number(b.totalBytes - a.totalBytes) / days;
}

function humanBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(0)} MB`;
  return `${(n / 1024).toFixed(0)} KB`;
}

/** Dispositions under which a table may legitimately grow: it is swept, or it is a regulated record. */
function dispositionRemovesOrJustifiesGrowth(label: string | null): boolean {
  if (!label) return false;
  return /^\d+d$/.test(label) || label === "retained";
}

/**
 * PURE. `history` holds recent samples per table (newest included). Emits at
 * most one finding per (type, table).
 */
export function detectGrowthDrift(history: ReadonlyMap<string, readonly TableGrowthSampleRow[]>): DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const [table, samples] of history) {
    if (samples.length === 0) continue;
    const latest = [...samples].sort((a, b) => b.sampledAt.getTime() - a.sampledAt.getTime())[0];
    const perDay = bytesPerDay(samples);
    const rowsPerDay = latest.rowsLast24h;
    const growing =
      (rowsPerDay !== null && rowsPerDay >= GROWTH_ROWS_PER_DAY_THRESHOLD) ||
      (perDay !== null && perDay >= GROWTH_BYTES_PER_DAY_THRESHOLD);
    const targetSourceKey = latest.model ? `prisma:model:${latest.model}` : null;
    const total = Number(latest.totalBytes);

    if (growing && !dispositionRemovesOrJustifiesGrowth(latest.declaredRetention)) {
      const projected = total + (perDay ?? 0) * 365;
      findings.push({
        issueType: "growth-without-disposition",
        issueKey: `growth-without-disposition:${table}`,
        severity: "error",
        message: latest.declaredRetention
          ? `${table} grows (${rowsPerDay ?? "?"} rows/day, ${perDay === null ? "rate unknown" : humanBytes(perDay) + "/day"}) but its declaration (${latest.declaredRetention}) never removes rows`
          : `${table} grows (${rowsPerDay ?? "?"} rows/day, ${perDay === null ? "rate unknown" : humanBytes(perDay) + "/day"}) and carries no /// @dpf declaration`,
        targetSourceKey,
        details: {
          table,
          model: latest.model,
          declaredRetention: latest.declaredRetention,
          rowsLast24h: rowsPerDay,
          bytesPerDay: perDay,
          totalBytes: total,
          projected12MonthBytes: projected,
          projected12Month: humanBytes(projected),
          remedy: latest.declaredRetention
            ? "Give the model a purge window (retention=<Nd> timeAxis=<col>) or make the writer write on change."
            : "Declare lifecycle= and retention= on the model; a growing table without a disposition is unbounded.",
        },
      });
    }

    const toast = Number(latest.toastBytes);
    if (total >= TOAST_MIN_TOTAL_BYTES && toast / total >= TOAST_SHARE_THRESHOLD) {
      findings.push({
        issueType: "payload-anatomy",
        issueKey: `payload-anatomy:${table}`,
        severity: "warn",
        message: `${table}: ${Math.round((toast / total) * 100)}% of ${humanBytes(total)} is TOAST — a JSON/text column is carrying blobs that belong in the content-addressed store`,
        targetSourceKey,
        details: {
          table,
          model: latest.model,
          totalBytes: total,
          toastBytes: toast,
          toastShare: toast / total,
          liveRows: Number(latest.liveRows),
          avgRowBytes: Number(latest.liveRows) > 0 ? Math.round(total / Number(latest.liveRows)) : null,
          remedy: "Route oversized payloads through lib/evidence/bounded-output.ts (64 KB inline ceiling) and keep a digest in the row.",
        },
      });
    }
  }
  return findings;
}

/**
 * A finding is persistent when the same issueKey was emitted for the last
 * PERSISTENT_NIGHTS samples. `previousKeysByNight` is newest-first, one set of
 * issueKeys per prior night (the caller derives it from stored issues or
 * re-running the detector over historical samples).
 */
export function persistentFindings(
  findings: readonly DriftFinding[],
  previousKeysByNight: ReadonlyArray<ReadonlySet<string>>,
): DriftFinding[] {
  const nights = previousKeysByNight.slice(0, PERSISTENT_NIGHTS - 1);
  if (nights.length < PERSISTENT_NIGHTS - 1) return [];
  return findings.filter((f) => nights.every((keys) => keys.has(f.issueKey)));
}

/** Group stored samples by table for the detector. */
export function groupSamplesByTable(samples: readonly TableGrowthSampleRow[]): Map<string, TableGrowthSampleRow[]> {
  const m = new Map<string, TableGrowthSampleRow[]>();
  for (const s of samples) {
    const arr = m.get(s.table) ?? [];
    arr.push(s);
    m.set(s.table, arr);
  }
  return m;
}
