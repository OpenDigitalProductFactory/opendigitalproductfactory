import { describe, expect, it } from "vitest";
import { admitCounters, spearman, type PassSample } from "./speed-counter-admission";
import { readSpeedCounters } from "./speed-counters";

function pass(rows: Array<[string, number, number, number, number, number]>): PassSample[] {
  return rows.map(([routePath, scriptBytes, requestCount, layoutShifts, longTasks, navigationAndSettleMs]) => ({
    routePath,
    counters: { scriptBytes, requestCount, layoutShifts, longTasks },
    navigationAndSettleMs,
  }));
}

// 10 routes: script bytes rise with time, requests flap between passes,
// layout shifts are constant, long tasks are uncorrelated with time.
const ROUTES = Array.from({ length: 10 }, (_, i) => `/r${i}`);
const A = pass(ROUTES.map((r, i) => [r, 100_000 + i * 20_000, 30 + (i % 2), 0, (i * 7) % 3, 400 + i * 60]));
const B = pass(ROUTES.map((r, i) => [r, 100_000 + i * 20_000, 30 + ((i + 1) % 2), 0, (i * 7) % 3, 410 + i * 60]));

describe("spearman (BI-BDB43823 AC-2)", () => {
  it("is 1 for a monotone relationship and -1 for an inverse one", () => {
    expect(spearman([1, 2, 3, 4], [10, 40, 90, 160])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });
  it("handles ties with average ranks", () => {
    expect(spearman([1, 1, 2, 3], [1, 2, 3, 4])).toBeGreaterThan(0.9);
  });
  it("is null when one side has no variance", () => {
    expect(spearman([5, 5, 5], [1, 2, 3])).toBeNull();
  });
});

describe("admitCounters (BI-BDB43823 AC-2, AC-3)", () => {
  const verdicts = Object.fromEntries(admitCounters(A, B).map((v) => [v.counter, v]));

  it("admits a repeatable counter that tracks wall-clock time", () => {
    expect(verdicts.scriptBytes.status).toBe("admitted");
    expect(verdicts.scriptBytes.rho).toBeCloseTo(1);
    expect(verdicts.scriptBytes.n).toBe(10);
  });

  it("rejects a counter that differs between two passes on the same tree", () => {
    expect(verdicts.requestCount.status).toBe("rejected");
    expect(verdicts.requestCount.repeatable).toBe(false);
    expect(verdicts.requestCount.reason).toMatch(/not repeatable/);
    expect(verdicts.requestCount.mismatchedRoutes).toHaveLength(10);
  });

  it("rejects a constant counter because it cannot track time", () => {
    expect(verdicts.layoutShifts.status).toBe("rejected");
    expect(verdicts.layoutShifts.reason).toMatch(/no variance/);
  });

  it("rejects a repeatable counter that does not track time", () => {
    expect(verdicts.longTasks.status).toBe("rejected");
    expect(verdicts.longTasks.reason).toMatch(/does not track wall-clock time/);
  });

  it("refuses to admit anything on too few routes", () => {
    const few = admitCounters(A.slice(0, 3), B.slice(0, 3));
    expect(few.every((v) => v.status === "rejected")).toBe(true);
  });
});

describe("readSpeedCounters (BI-BDB43823 AC-1)", () => {
  it("counts script bytes, requests, unexpected shifts and long tasks", () => {
    expect(
      readSpeedCounters({
        resources: [
          { initiatorType: "script", encodedBodySize: 1000 },
          { initiatorType: "script", encodedBodySize: 500 },
          { initiatorType: "fetch", encodedBodySize: 9999 },
        ],
        layoutShifts: [
          { value: 0.02, hadRecentInput: false },
          { value: 0.5, hadRecentInput: true },
          { value: 0, hadRecentInput: false },
        ],
        longTasks: [{ duration: 51 }, { duration: 50 }, { duration: 200 }],
      }),
    ).toEqual({ scriptBytes: 1500, requestCount: 3, layoutShifts: 1, longTasks: 2 });
  });
});
