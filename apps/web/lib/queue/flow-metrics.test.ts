import { describe, it, expect } from "vitest";
import {
  computeFlowDurations,
  isFirstPassSuccess,
  metSla,
  percentile,
  summarizeQueueWindow,
  queueMetricPeriod,
  type QueueItemTimeline,
} from "./flow-metrics";

const t = (iso: string) => new Date(iso);

describe("computeFlowDurations", () => {
  it("derives wait, process, cycle from a full timeline", () => {
    const item: QueueItemTimeline = {
      enqueuedAt: t("2026-07-06T00:00:00Z"),
      startedAt: t("2026-07-06T00:05:00Z"),
      finishedAt: t("2026-07-06T00:20:00Z"),
    };
    expect(computeFlowDurations(item)).toEqual({
      waitMs: 5 * 60_000,
      processMs: 15 * 60_000,
      cycleMs: 20 * 60_000,
    });
  });

  it("returns null for durations whose endpoints are absent", () => {
    const item: QueueItemTimeline = { enqueuedAt: t("2026-07-06T00:00:00Z") };
    expect(computeFlowDurations(item)).toEqual({
      waitMs: null,
      processMs: null,
      cycleMs: null,
    });
  });

  it("uses cancelledAt as the cycle endpoint when not finished", () => {
    const item: QueueItemTimeline = {
      enqueuedAt: t("2026-07-06T00:00:00Z"),
      cancelledAt: t("2026-07-06T00:10:00Z"),
    };
    expect(computeFlowDurations(item).cycleMs).toBe(10 * 60_000);
  });

  it("guards against out-of-order (negative) durations", () => {
    const item: QueueItemTimeline = {
      enqueuedAt: t("2026-07-06T00:05:00Z"),
      startedAt: t("2026-07-06T00:00:00Z"), // before enqueue — clock skew
    };
    expect(computeFlowDurations(item).waitMs).toBeNull();
  });
});

describe("isFirstPassSuccess", () => {
  it("is true for a clean success with no rework", () => {
    expect(isFirstPassSuccess({ outcome: "success", requeueCount: 0 })).toBe(true);
  });
  it("is false when the item was requeued for rework", () => {
    expect(isFirstPassSuccess({ outcome: "success", requeueCount: 1 })).toBe(false);
  });
  it("is false for a failed outcome", () => {
    expect(isFirstPassSuccess({ outcome: "failed", requeueCount: 0 })).toBe(false);
  });
});

describe("metSla", () => {
  it("returns null when no SLA is set", () => {
    expect(metSla({ finishedAt: t("2026-07-06T00:00:00Z") })).toBeNull();
  });
  it("is true when finished before the deadline", () => {
    expect(
      metSla({
        finishedAt: t("2026-07-06T00:00:00Z"),
        slaDueAt: t("2026-07-06T01:00:00Z"),
      }),
    ).toBe(true);
  });
  it("is false when finished after the deadline", () => {
    expect(
      metSla({
        finishedAt: t("2026-07-06T02:00:00Z"),
        slaDueAt: t("2026-07-06T01:00:00Z"),
      }),
    ).toBe(false);
  });
});

describe("percentile", () => {
  it("returns null for an empty sample", () => {
    expect(percentile([], 0.5)).toBeNull();
  });
  it("computes nearest-rank p50 and p95", () => {
    const vals = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(vals, 0.5)).toBe(50);
    expect(percentile(vals, 0.95)).toBe(100);
  });
  it("handles a single value", () => {
    expect(percentile([42], 0.95)).toBe(42);
  });
});

describe("summarizeQueueWindow", () => {
  it("aggregates arrivals, throughput, percentiles, FPY, SLA, abandonment", () => {
    const items: QueueItemTimeline[] = [
      // clean success, met SLA
      {
        enqueuedAt: t("2026-07-06T00:00:00Z"),
        startedAt: t("2026-07-06T00:02:00Z"),
        finishedAt: t("2026-07-06T00:10:00Z"),
        outcome: "success",
        requeueCount: 0,
        slaDueAt: t("2026-07-06T01:00:00Z"),
      },
      // success but reworked (breaks FPY), missed SLA
      {
        enqueuedAt: t("2026-07-06T00:00:00Z"),
        startedAt: t("2026-07-06T00:04:00Z"),
        finishedAt: t("2026-07-06T02:00:00Z"),
        outcome: "success",
        requeueCount: 1,
        slaDueAt: t("2026-07-06T01:00:00Z"),
      },
      // arrived and cancelled while queued (abandonment)
      {
        enqueuedAt: t("2026-07-06T00:00:00Z"),
        cancelledAt: t("2026-07-06T00:30:00Z"),
        outcome: "cancelled",
      },
    ];
    const s = summarizeQueueWindow(items);
    expect(s.arrivals).toBe(3);
    expect(s.throughput).toBe(2); // two finished
    expect(s.firstPassYield).toBeCloseTo(0.5); // 1 of 2 finished was first-pass
    expect(s.slaAttainment).toBeCloseTo(0.5); // 1 of 2 SLA-eligible met it
    expect(s.abandonmentRate).toBeCloseTo(1 / 3);
    expect(s.waitP50Ms).not.toBeNull();
  });

  it("returns null ratios for an empty window", () => {
    const s = summarizeQueueWindow([]);
    expect(s.arrivals).toBe(0);
    expect(s.throughput).toBe(0);
    expect(s.firstPassYield).toBeNull();
    expect(s.slaAttainment).toBeNull();
    expect(s.abandonmentRate).toBeNull();
  });
});

describe("queueMetricPeriod", () => {
  it("produces a UTC day-grain key", () => {
    expect(queueMetricPeriod(t("2026-07-06T23:59:59Z"))).toBe("2026-07-06");
  });
});
