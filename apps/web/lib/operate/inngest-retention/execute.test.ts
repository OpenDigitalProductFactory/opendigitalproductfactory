import { describe, it, expect } from "vitest";

import { runInngestRetentionSweep, type SqlRunner, type SqlResult } from "./execute";
import {
  resolveInngestDatabaseUrl,
  nextInngestRetentionRunAt,
} from "./constants";

interface RecordedQuery {
  text: string;
  params: unknown[];
}

/**
 * Fake SqlRunner. `deleteRowCounts` maps a table name to the sequence of
 * rowCounts its batched DELETEs return (consumed in order); `counts` maps a
 * table to the SELECT count(*) value for dry-run. A table missing from a map
 * defaults to a single 0.
 */
function fakeSql(opts: {
  deleteRowCounts?: Record<string, number[]>;
  counts?: Record<string, number>;
  throwOn?: string;
}): { sql: SqlRunner; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const deleteCursors: Record<string, number> = {};

  function tableOf(text: string): string {
    // "DELETE FROM <t> WHERE ctid …" or "SELECT count(*)::int AS c FROM <t> …"
    const del = text.match(/DELETE FROM (\w+)/);
    if (del) return del[1];
    const sel = text.match(/FROM (\w+) WHERE/);
    return sel ? sel[1] : "?";
  }
  // The orphan reap targets function_runs but must be distinguishable from the
  // function_runs history trim. Both hit table "function_runs"; the orphan one
  // carries the NOT EXISTS predicate.
  function keyOf(text: string): string {
    const t = tableOf(text);
    if (t === "function_runs" && text.includes("NOT EXISTS")) {
      return "function_runs:orphans";
    }
    return t;
  }

  const sql: SqlRunner = {
    async query(text: string, params: unknown[] = []): Promise<SqlResult> {
      queries.push({ text, params });
      const key = keyOf(text);
      if (opts.throwOn && key === opts.throwOn) {
        throw new Error(`boom:${key}`);
      }
      if (text.startsWith("SELECT count")) {
        const c = opts.counts?.[key] ?? 0;
        return { rowCount: 1, rows: [{ c }] };
      }
      // batched DELETE
      const seq = opts.deleteRowCounts?.[key] ?? [0];
      const i = deleteCursors[key] ?? 0;
      deleteCursors[key] = i + 1;
      const n = i < seq.length ? seq[i] : 0;
      return { rowCount: n, rows: [] };
    },
  };
  return { sql, queries };
}

const NOW = new Date("2026-07-08T12:00:00.000Z");

describe("runInngestRetentionSweep", () => {
  it("dry run only counts — never issues a DELETE", async () => {
    const { sql, queries } = fakeSql({
      counts: {
        "function_runs:orphans": 3,
        function_runs: 5,
        spans: 100,
        traces: 400,
        trace_runs: 7,
        history: 20,
        function_finishes: 5,
      },
    });
    const report = await runInngestRetentionSweep({ sql, now: NOW, dryRun: true });

    expect(queries.every((q) => q.text.startsWith("SELECT count"))).toBe(true);
    expect(report.orphansReaped).toBe(3);
    // historyTrimmed sums every history table (not the orphan reap)
    expect(report.historyTrimmed).toBe(5 + 100 + 20 + 400 + 5 + 7);
    expect(report.byTable["function_runs:orphans"]).toBe(3);
    expect(report.byTable["spans"]).toBe(100);
    expect(report.errorCount).toBe(0);
  });

  it("real run reaps orphans first, then trims each history table", async () => {
    const { sql, queries } = fakeSql({
      deleteRowCounts: {
        "function_runs:orphans": [10, 0],
        function_runs: [4, 0],
        spans: [50, 0],
        traces: [200, 0],
        history: [0],
        trace_runs: [7, 0],
        function_finishes: [0],
      },
    });
    const report = await runInngestRetentionSweep({ sql, now: NOW, dryRun: false });

    const firstDelete = queries.find((q) => q.text.startsWith("DELETE"));
    expect(firstDelete?.text).toContain("function_runs");
    expect(firstDelete?.text).toContain("NOT EXISTS");

    expect(report.orphansReaped).toBe(10);
    expect(report.byTable["spans"]).toBe(50);
    expect(report.byTable["traces"]).toBe(200);
    expect(report.historyTrimmed).toBe(4 + 50 + 200 + 0 + 7 + 0);
    expect(report.capped).toEqual([]);
    expect(report.errorCount).toBe(0);
  });

  it("passes a Date cutoff for timestamp tables and a unix-ms number for trace_runs", async () => {
    const { sql, queries } = fakeSql({ deleteRowCounts: {} });
    await runInngestRetentionSweep({ sql, now: NOW, dryRun: false });

    const spans = queries.find((q) => q.text.includes("DELETE FROM spans"));
    expect(spans?.params[0]).toBeInstanceOf(Date);

    const traceRuns = queries.find((q) => q.text.includes("DELETE FROM trace_runs"));
    expect(typeof traceRuns?.params[0]).toBe("number");
    // 7-day cutoff in unix ms
    expect(traceRuns?.params[0]).toBe(NOW.getTime() - 7 * 86_400_000);
    // trace_runs also guards ended_at > 0
    expect(traceRuns?.text).toContain("ended_at > 0");
  });

  it("respects the per-table cap and flags the capped table", async () => {
    // Every batch returns a full batch → never short → capped by count.
    const { sql } = fakeSql({
      deleteRowCounts: { spans: Array(1000).fill(10) },
    });
    const report = await runInngestRetentionSweep({
      sql,
      now: NOW,
      dryRun: false,
      batchSize: 10,
      perTableCap: 50,
    });
    expect(report.byTable["spans"]).toBe(50);
    expect(report.capped).toContain("spans");
  });

  it("a failing table is recorded and does not abort the rest", async () => {
    const { sql } = fakeSql({
      throwOn: "spans",
      deleteRowCounts: {
        "function_runs:orphans": [2, 0],
        traces: [9, 0],
      },
    });
    const report = await runInngestRetentionSweep({ sql, now: NOW, dryRun: false });

    expect(report.errorCount).toBe(1);
    expect(report.errors[0].table).toBe("spans");
    // work after the failure still ran
    expect(report.orphansReaped).toBe(2);
    expect(report.byTable["traces"]).toBe(9);
  });

  it("partitions the finished-run history trim (EXISTS) from the orphan reap (NOT EXISTS)", async () => {
    const { sql, queries } = fakeSql({ deleteRowCounts: {} });
    await runInngestRetentionSweep({ sql, now: NOW, dryRun: false });

    const fnRunsQueries = queries.filter((q) =>
      q.text.includes("DELETE FROM function_runs"),
    );
    const orphanReap = fnRunsQueries.find((q) => q.text.includes("NOT EXISTS"));
    const historyTrim = fnRunsQueries.find((q) => !q.text.includes("NOT EXISTS"));

    expect(orphanReap).toBeTruthy();
    expect(historyTrim).toBeTruthy();
    // the history trim still requires a finish row to exist
    expect(historyTrim?.text).toContain("EXISTS");
  });
});

describe("resolveInngestDatabaseUrl", () => {
  it("derives db=inngest from DATABASE_URL and strips prisma-only params", () => {
    const url = resolveInngestDatabaseUrl({
      DATABASE_URL:
        "postgresql://dpf:secret@postgres:5432/dpf?schema=public&connection_limit=5",
    });
    expect(url).toBe("postgresql://dpf:secret@postgres:5432/inngest");
  });

  it("prefers an explicit INNGEST_POSTGRES_URI", () => {
    const url = resolveInngestDatabaseUrl({
      INNGEST_POSTGRES_URI: "postgres://u:p@postgres:5432/inngest",
      DATABASE_URL: "postgresql://dpf:secret@postgres:5432/dpf",
    });
    expect(url).toBe("postgres://u:p@postgres:5432/inngest");
  });

  it("adds a scheme to a bare INNGEST_POSTGRES_URI", () => {
    const url = resolveInngestDatabaseUrl({
      INNGEST_POSTGRES_URI: "u:p@postgres:5432/inngest",
    });
    expect(url).toBe("postgresql://u:p@postgres:5432/inngest");
  });

  it("returns null with no source", () => {
    expect(resolveInngestDatabaseUrl({})).toBeNull();
  });
});

describe("nextInngestRetentionRunAt", () => {
  it("returns the next :17 past a 6-hour UTC boundary", () => {
    // 12:00 → next slot 12:17
    expect(nextInngestRetentionRunAt(new Date("2026-07-08T12:00:00Z")).toISOString()).toBe(
      "2026-07-08T12:17:00.000Z",
    );
    // 12:17 exactly → advance to 18:17
    expect(nextInngestRetentionRunAt(new Date("2026-07-08T12:17:00Z")).toISOString()).toBe(
      "2026-07-08T18:17:00.000Z",
    );
    // 23:30 → next day 00:17
    expect(nextInngestRetentionRunAt(new Date("2026-07-08T23:30:00Z")).toISOString()).toBe(
      "2026-07-09T00:17:00.000Z",
    );
  });
});
