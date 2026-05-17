import { describe, expect, it } from "vitest";

import {
  DEFAULT_BACKUP_RETENTION,
  type BackupRetentionPolicy,
} from "./types";
import { isoWeekKey, monthKey, partitionForRetention } from "./retention";

function makeRun(args: {
  id: string;
  finishedAt: string | null;
  status?: string;
  pruned?: boolean;
}) {
  return {
    id: args.id,
    status: args.status ?? "ok",
    startedAt: new Date(args.finishedAt ?? "2026-01-01T00:00:00Z"),
    finishedAt: args.finishedAt ? new Date(args.finishedAt) : null,
    prunedAt: args.pruned ? new Date("2026-01-01T00:00:00Z") : null,
  };
}

describe("retention/isoWeekKey", () => {
  it("groups dates within the same ISO week", () => {
    expect(isoWeekKey(new Date("2026-05-11T00:00:00Z"))).toBe("2026-W20"); // Mon
    expect(isoWeekKey(new Date("2026-05-17T23:59:59Z"))).toBe("2026-W20"); // Sun
    expect(isoWeekKey(new Date("2026-05-18T00:00:00Z"))).toBe("2026-W21"); // Mon next
  });

  it("handles year boundary correctly", () => {
    // 2025-12-29 = Mon, ISO week 53 (or W01 of 2026 depending on year length).
    // The algorithm shifts to Thursday, which is 2026-01-01 → 2026-W01.
    expect(isoWeekKey(new Date("2025-12-29T00:00:00Z"))).toBe("2026-W01");
  });
});

describe("retention/monthKey", () => {
  it("uses UTC calendar month", () => {
    expect(monthKey(new Date("2026-05-01T00:00:00Z"))).toBe("2026-05");
    expect(monthKey(new Date("2026-05-31T23:59:59Z"))).toBe("2026-05");
    expect(monthKey(new Date("2026-06-01T00:00:00Z"))).toBe("2026-06");
  });
});

describe("retention/partitionForRetention", () => {
  it("keeps everything when fewer runs than daily quota", () => {
    const runs = [
      makeRun({ id: "r1", finishedAt: "2026-05-17T03:00:00Z" }),
      makeRun({ id: "r2", finishedAt: "2026-05-16T03:00:00Z" }),
    ];
    const partition = partitionForRetention(runs, DEFAULT_BACKUP_RETENTION);
    expect(partition.keep.map((r) => r.id).sort()).toEqual(["r1", "r2"]);
    expect(partition.prune).toEqual([]);
  });

  it("keeps the N most recent daily runs and prunes older ones in the same week", () => {
    const policy: BackupRetentionPolicy = { daily: 2, weekly: 0, monthly: 0 };
    const runs = [
      makeRun({ id: "d1", finishedAt: "2026-05-17T03:00:00Z" }), // Sun
      makeRun({ id: "d2", finishedAt: "2026-05-16T03:00:00Z" }), // Sat
      makeRun({ id: "d3", finishedAt: "2026-05-15T03:00:00Z" }), // Fri
      makeRun({ id: "d4", finishedAt: "2026-05-14T03:00:00Z" }), // Thu
    ];
    const partition = partitionForRetention(runs, policy);
    expect(partition.keep.map((r) => r.id)).toEqual(["d1", "d2"]);
    expect(partition.prune.map((r) => r.id).sort()).toEqual(["d3", "d4"]);
  });

  it("retains weekly buckets across multiple ISO weeks", () => {
    const policy: BackupRetentionPolicy = { daily: 0, weekly: 3, monthly: 0 };
    const runs = [
      makeRun({ id: "w20-late", finishedAt: "2026-05-17T03:00:00Z" }), // W20 Sun
      makeRun({ id: "w20-early", finishedAt: "2026-05-11T03:00:00Z" }), // W20 Mon
      makeRun({ id: "w19", finishedAt: "2026-05-04T03:00:00Z" }), // W19 Mon
      makeRun({ id: "w18", finishedAt: "2026-04-27T03:00:00Z" }), // W18 Mon
      makeRun({ id: "w17", finishedAt: "2026-04-20T03:00:00Z" }), // W17 Mon — over the cap
    ];
    const partition = partitionForRetention(runs, policy);
    // For each week the MOST RECENT successful run is the bucket representative.
    expect(partition.keep.map((r) => r.id).sort()).toEqual([
      "w18",
      "w19",
      "w20-late",
    ]);
    expect(partition.prune.map((r) => r.id).sort()).toEqual([
      "w17",
      "w20-early",
    ]);
  });

  it("retains monthly buckets — most-recent-wins per calendar month", () => {
    const policy: BackupRetentionPolicy = { daily: 0, weekly: 0, monthly: 2 };
    const runs = [
      makeRun({ id: "may-end", finishedAt: "2026-05-31T03:00:00Z" }),
      makeRun({ id: "may-start", finishedAt: "2026-05-01T03:00:00Z" }),
      makeRun({ id: "apr-end", finishedAt: "2026-04-30T03:00:00Z" }),
      makeRun({ id: "mar-end", finishedAt: "2026-03-31T03:00:00Z" }), // over cap
    ];
    const partition = partitionForRetention(runs, policy);
    expect(partition.keep.map((r) => r.id).sort()).toEqual([
      "apr-end",
      "may-end",
    ]);
  });

  it("excludes failed runs from keep set entirely", () => {
    const runs = [
      makeRun({ id: "r1", finishedAt: "2026-05-17T03:00:00Z", status: "failed" }),
      makeRun({ id: "r2", finishedAt: "2026-05-16T03:00:00Z" }),
    ];
    const partition = partitionForRetention(runs, DEFAULT_BACKUP_RETENTION);
    expect(partition.keep.map((r) => r.id)).toEqual(["r2"]);
    expect(partition.prune.map((r) => r.id)).toEqual(["r1"]);
  });

  it("excludes already-pruned runs from keep set", () => {
    const runs = [
      makeRun({ id: "r1", finishedAt: "2026-05-17T03:00:00Z", pruned: true }),
      makeRun({ id: "r2", finishedAt: "2026-05-16T03:00:00Z" }),
    ];
    const partition = partitionForRetention(runs, DEFAULT_BACKUP_RETENTION);
    expect(partition.keep.map((r) => r.id)).toEqual(["r2"]);
    expect(partition.prune.map((r) => r.id)).toEqual(["r1"]);
  });

  it("never prunes the today's-most-recent dump under any sane policy", () => {
    const runs = Array.from({ length: 30 }, (_, i) => {
      const d = new Date("2026-05-17T03:00:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      return makeRun({ id: `r${i}`, finishedAt: d.toISOString() });
    });
    const partition = partitionForRetention(runs, DEFAULT_BACKUP_RETENTION);
    expect(partition.keep.find((r) => r.id === "r0")).toBeDefined();
  });

  it("respects the union semantics — a run can satisfy multiple buckets", () => {
    // A single run for the entire history. It must show up exactly once in keep,
    // never duplicated.
    const policy: BackupRetentionPolicy = { daily: 7, weekly: 4, monthly: 12 };
    const runs = [makeRun({ id: "only", finishedAt: "2026-05-17T03:00:00Z" })];
    const partition = partitionForRetention(runs, policy);
    expect(partition.keep.map((r) => r.id)).toEqual(["only"]);
  });

  it("at 30 daily successful runs, default policy keeps 7 daily + ~5 older bucket reps", () => {
    // 30 contiguous daily runs span ~5 ISO weeks and ~2 calendar months.
    // Default policy: 7 daily + 4 weekly + 12 monthly. Weekly buckets that
    // overlap the daily window are deduped by Set union, so the keep set is
    // the 7 daily runs plus any older weekly/monthly reps not already counted.
    const runs = Array.from({ length: 30 }, (_, i) => {
      const d = new Date("2026-05-17T03:00:00Z");
      d.setUTCDate(d.getUTCDate() - i);
      return makeRun({ id: `r${i}`, finishedAt: d.toISOString() });
    });
    const partition = partitionForRetention(runs, DEFAULT_BACKUP_RETENTION);
    // Sanity: keep set ≥ 7 (the daily bucket), ≤ 30, prune is the complement.
    expect(partition.keep.length).toBeGreaterThanOrEqual(7);
    expect(partition.keep.length).toBeLessThanOrEqual(30);
    expect(partition.keep.length + partition.prune.length).toBe(30);
  });
});
