import { describe, expect, it } from "vitest";

import {
  evaluateJobStaleness,
  readStalenessState,
  mergeStalenessState,
  type JobStalenessState,
  type StalenessThresholds,
} from "./staleness-escalation";

const THRESHOLDS: StalenessThresholds = { maxConsecutiveErrors: 4, maxAgeMs: 2 * 3_600_000 }; // 4 errors / 2h
const NOW = new Date("2026-06-23T12:00:00.000Z");

describe("evaluateJobStaleness", () => {
  it("a successful run resets counters and never escalates", () => {
    const prev: JobStalenessState = { lastOkAt: "2026-06-20T00:00:00.000Z", consecutiveErrors: 9 };
    const d = evaluateJobStaleness(prev, "ok", NOW, THRESHOLDS);
    expect(d.escalate).toBe(false);
    expect(d.reason).toBeNull();
    expect(d.nextState).toEqual({ lastOkAt: NOW.toISOString(), consecutiveErrors: 0 });
  });

  it("a single recent failure below thresholds does not escalate", () => {
    const prev: JobStalenessState = { lastOkAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(), consecutiveErrors: 0 };
    const d = evaluateJobStaleness(prev, "error", NOW, THRESHOLDS);
    expect(d.escalate).toBe(false);
    expect(d.nextState.consecutiveErrors).toBe(1);
    expect(d.nextState.lastOkAt).toBe(prev.lastOkAt); // preserved on error
  });

  it("escalates once consecutive errors reach the threshold", () => {
    const prev: JobStalenessState = { lastOkAt: new Date(NOW.getTime() - 10 * 60_000).toISOString(), consecutiveErrors: 3 };
    const d = evaluateJobStaleness(prev, "error", NOW, THRESHOLDS);
    expect(d.nextState.consecutiveErrors).toBe(4);
    expect(d.escalate).toBe(true);
    expect(d.reason).toMatch(/4 consecutive failed run/);
  });

  it("escalates by age when the last success is older than maxAgeMs (even below the error count)", () => {
    const prev: JobStalenessState = { lastOkAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(), consecutiveErrors: 0 };
    const d = evaluateJobStaleness(prev, "error", NOW, THRESHOLDS);
    expect(d.nextState.consecutiveErrors).toBe(1);
    expect(d.escalate).toBe(true);
    expect(d.reason).toMatch(/no successful run for ~3h/);
  });

  it("a never-succeeded job does NOT escalate on its first error (no infinite age)", () => {
    const prev: JobStalenessState = { lastOkAt: null, consecutiveErrors: 0 };
    const d = evaluateJobStaleness(prev, "error", NOW, THRESHOLDS);
    expect(d.escalate).toBe(false);
    expect(d.nextState).toEqual({ lastOkAt: null, consecutiveErrors: 1 });
  });

  it("a never-succeeded job escalates on the consecutive-error threshold", () => {
    const prev: JobStalenessState = { lastOkAt: null, consecutiveErrors: 3 };
    const d = evaluateJobStaleness(prev, "error", NOW, THRESHOLDS);
    expect(d.escalate).toBe(true);
    expect(d.reason).toMatch(/4 consecutive failed run/);
    expect(d.reason).not.toMatch(/no successful run for/); // age branch inactive when never-ok
  });

  it("reports both reasons when both thresholds trip", () => {
    const prev: JobStalenessState = { lastOkAt: new Date(NOW.getTime() - 5 * 3_600_000).toISOString(), consecutiveErrors: 3 };
    const d = evaluateJobStaleness(prev, "error", NOW, THRESHOLDS);
    expect(d.escalate).toBe(true);
    expect(d.reason).toMatch(/consecutive failed run/);
    expect(d.reason).toMatch(/no successful run for/);
  });
});

describe("readStalenessState", () => {
  it("returns empty state for null / non-object / missing key", () => {
    expect(readStalenessState(null)).toEqual({ lastOkAt: null, consecutiveErrors: 0 });
    expect(readStalenessState("nope")).toEqual({ lastOkAt: null, consecutiveErrors: 0 });
    expect(readStalenessState({ other: 1 })).toEqual({ lastOkAt: null, consecutiveErrors: 0 });
  });

  it("parses a valid staleness sub-state", () => {
    const md = { staleness: { lastOkAt: "2026-06-23T00:00:00.000Z", consecutiveErrors: 2 }, other: "x" };
    expect(readStalenessState(md)).toEqual({ lastOkAt: "2026-06-23T00:00:00.000Z", consecutiveErrors: 2 });
  });

  it("defaults malformed fields", () => {
    expect(readStalenessState({ staleness: { lastOkAt: 5, consecutiveErrors: -3 } })).toEqual({
      lastOkAt: null,
      consecutiveErrors: 0,
    });
  });
});

describe("mergeStalenessState", () => {
  it("sets staleness while preserving other metadata keys", () => {
    const merged = mergeStalenessState({ githubPrEtag: "abc" }, { lastOkAt: null, consecutiveErrors: 1 });
    expect(merged).toEqual({ githubPrEtag: "abc", staleness: { lastOkAt: null, consecutiveErrors: 1 } });
  });

  it("handles null/garbage base metadata", () => {
    expect(mergeStalenessState(null, { lastOkAt: null, consecutiveErrors: 0 })).toEqual({
      staleness: { lastOkAt: null, consecutiveErrors: 0 },
    });
  });
});
