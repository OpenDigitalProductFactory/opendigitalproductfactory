import { describe, expect, it, vi } from "vitest";
import {
  computeNudgeShare,
  computeP95,
  detectCoworkerNudgeRateRegressions,
  groupDispatchRowsIntoTurns,
  shouldFileLatencyRegression,
  shouldFileNudgeRateRegression,
  type CoworkerTurnMetricRow,
} from "./coworker-regression-detector";

function metricRow(
  overrides: Partial<CoworkerTurnMetricRow> & {
    threadId: string;
    agentMessageId: string;
    nudges: number;
  },
): CoworkerTurnMetricRow {
  return {
    agentId: "support-specialist",
    routeContext: "/platform/ai",
    taskType: "conversation",
    createdAt: new Date("2026-06-05T10:00:00Z"),
    ...overrides,
  };
}

describe("coworker latency regression detector", () => {
  it("groups dispatch rows by threadId and agentMessageId and sums durationMs", () => {
    const turns = groupDispatchRowsIntoTurns([
      {
        threadId: "thr-1",
        agentMessageId: "msg-1",
        agentId: "support-specialist",
        routeContext: "/platform/ai",
        taskType: "conversation",
        durationMs: 1200,
        startedAt: new Date("2026-06-05T10:00:00Z"),
      },
      {
        threadId: "thr-1",
        agentMessageId: "msg-1",
        agentId: "support-specialist",
        routeContext: "/platform/ai",
        taskType: "conversation",
        durationMs: 800,
        startedAt: new Date("2026-06-05T10:00:02Z"),
      },
      {
        threadId: null,
        agentMessageId: "msg-2",
        agentId: "support-specialist",
        routeContext: "/platform/ai",
        taskType: "conversation",
        durationMs: 999,
        startedAt: new Date("2026-06-05T10:00:03Z"),
      },
    ]);

    expect(turns).toEqual([
      expect.objectContaining({
        threadId: "thr-1",
        agentMessageId: "msg-1",
        agentId: "support-specialist",
        routeContext: "/platform/ai",
        totalMs: 2000,
      }),
    ]);
  });

  it("uses the earliest startedAt as the turn timestamp", () => {
    const turns = groupDispatchRowsIntoTurns([
      {
        threadId: "thr-1",
        agentMessageId: "msg-1",
        agentId: "a",
        routeContext: "/r",
        taskType: null,
        durationMs: 500,
        startedAt: new Date("2026-06-05T10:00:05Z"),
      },
      {
        threadId: "thr-1",
        agentMessageId: "msg-1",
        agentId: "a",
        routeContext: "/r",
        taskType: null,
        durationMs: 500,
        startedAt: new Date("2026-06-05T10:00:01Z"),
      },
    ]);
    expect(turns).toHaveLength(1);
    expect(turns[0].startedAt).toEqual(new Date("2026-06-05T10:00:01Z"));
    expect(turns[0].totalMs).toBe(1000);
  });

  it("skips rows missing threadId, agentMessageId, or a positive durationMs", () => {
    const turns = groupDispatchRowsIntoTurns([
      // missing threadId
      {
        threadId: null,
        agentMessageId: "msg-a",
        agentId: "a",
        routeContext: "/r",
        taskType: null,
        durationMs: 1000,
        startedAt: new Date("2026-06-05T10:00:00Z"),
      },
      // missing agentMessageId
      {
        threadId: "thr-x",
        agentMessageId: null,
        agentId: "a",
        routeContext: "/r",
        taskType: null,
        durationMs: 1000,
        startedAt: new Date("2026-06-05T10:00:00Z"),
      },
      // zero/null durationMs
      {
        threadId: "thr-y",
        agentMessageId: "msg-y",
        agentId: "a",
        routeContext: "/r",
        taskType: null,
        durationMs: 0,
        startedAt: new Date("2026-06-05T10:00:00Z"),
      },
      {
        threadId: "thr-z",
        agentMessageId: "msg-z",
        agentId: "a",
        routeContext: "/r",
        taskType: null,
        durationMs: null,
        startedAt: new Date("2026-06-05T10:00:00Z"),
      },
    ]);
    expect(turns).toEqual([]);
  });

  describe("computeP95", () => {
    it("returns null for an empty array", () => {
      expect(computeP95([])).toBeNull();
    });

    it("returns the p95 value", () => {
      expect(computeP95([1000, 1100, 1200, 9000])).toBe(9000);
    });

    it("returns the single value for one sample", () => {
      expect(computeP95([4242])).toBe(4242);
    });
  });

  describe("shouldFileLatencyRegression", () => {
    it("files only when sample size and p95 ratio both clear the threshold", () => {
      expect(
        shouldFileLatencyRegression({
          recentP95Ms: 9000,
          baselineP95Ms: 2000,
          recentSampleCount: 12,
          minSamples: 10,
          factor: 3,
        }),
      ).toEqual({ file: true, ratio: 4.5 });
    });

    it("does not file when sample count is below minSamples", () => {
      expect(
        shouldFileLatencyRegression({
          recentP95Ms: 9000,
          baselineP95Ms: 2000,
          recentSampleCount: 5,
          minSamples: 10,
          factor: 3,
        }),
      ).toEqual({ file: false, ratio: 4.5 });
    });

    it("does not file when the ratio is under the factor", () => {
      expect(
        shouldFileLatencyRegression({
          recentP95Ms: 4000,
          baselineP95Ms: 2000,
          recentSampleCount: 20,
          minSamples: 10,
          factor: 3,
        }),
      ).toEqual({ file: false, ratio: 2 });
    });

    it("does not file when a window p95 is null", () => {
      expect(
        shouldFileLatencyRegression({
          recentP95Ms: null,
          baselineP95Ms: 2000,
          recentSampleCount: 20,
          minSamples: 10,
          factor: 3,
        }),
      ).toEqual({ file: false, ratio: null });
      expect(
        shouldFileLatencyRegression({
          recentP95Ms: 9000,
          baselineP95Ms: null,
          recentSampleCount: 20,
          minSamples: 10,
          factor: 3,
        }),
      ).toEqual({ file: false, ratio: null });
    });

    it("does not file when baseline p95 is zero", () => {
      expect(
        shouldFileLatencyRegression({
          recentP95Ms: 9000,
          baselineP95Ms: 0,
          recentSampleCount: 20,
          minSamples: 10,
          factor: 3,
        }),
      ).toEqual({ file: false, ratio: null });
    });
  });
});

describe("coworker nudge-rate regression detector", () => {
  describe("computeNudgeShare", () => {
    it("returns null for an empty window", () => {
      expect(computeNudgeShare([])).toBeNull();
    });

    it("returns the share of turns with at least one nudge", () => {
      const rows = [
        metricRow({ threadId: "t1", agentMessageId: "m1", nudges: 0 }),
        metricRow({ threadId: "t2", agentMessageId: "m2", nudges: 1 }),
        metricRow({ threadId: "t3", agentMessageId: "m3", nudges: 3 }),
        metricRow({ threadId: "t4", agentMessageId: "m4", nudges: 0 }),
      ];
      expect(computeNudgeShare(rows)).toBe(0.5);
    });
  });

  describe("shouldFileNudgeRateRegression", () => {
    it("files when recent share is >= factor x a positive baseline", () => {
      const result = shouldFileNudgeRateRegression({
        recentShare: 0.6,
        baselineShare: 0.1,
        recentSampleCount: 12,
        minSamples: 10,
        factor: 3,
        minNudgeRate: 0.2,
      });
      expect(result.file).toBe(true);
      expect(result.ratio).toBeCloseTo(6, 10);
    });

    it("does not file when recent share is under factor x baseline", () => {
      expect(
        shouldFileNudgeRateRegression({
          recentShare: 0.2,
          baselineShare: 0.1,
          recentSampleCount: 12,
          minSamples: 10,
          factor: 3,
          minNudgeRate: 0.2,
        }),
      ).toEqual({ file: false, ratio: 2 });
    });

    it("files on zero baseline when recent share clears the absolute floor", () => {
      expect(
        shouldFileNudgeRateRegression({
          recentShare: 0.25,
          baselineShare: 0,
          recentSampleCount: 12,
          minSamples: 10,
          factor: 3,
          minNudgeRate: 0.2,
        }),
      ).toEqual({ file: true, ratio: null });
    });

    it("does not file on zero baseline below the absolute floor", () => {
      expect(
        shouldFileNudgeRateRegression({
          recentShare: 0.1,
          baselineShare: 0,
          recentSampleCount: 12,
          minSamples: 10,
          factor: 3,
          minNudgeRate: 0.2,
        }),
      ).toEqual({ file: false, ratio: null });
    });

    it("does not file when the sample count is below minSamples", () => {
      expect(
        shouldFileNudgeRateRegression({
          recentShare: 1,
          baselineShare: 0,
          recentSampleCount: 3,
          minSamples: 10,
          factor: 3,
          minNudgeRate: 0.2,
        }),
      ).toEqual({ file: false, ratio: null });
    });

    it("does not file when the recent window is empty", () => {
      expect(
        shouldFileNudgeRateRegression({
          recentShare: null,
          baselineShare: 0.1,
          recentSampleCount: 0,
          minSamples: 10,
          factor: 3,
          minNudgeRate: 0.2,
        }),
      ).toEqual({ file: false, ratio: null });
    });
  });

  describe("detectCoworkerNudgeRateRegressions orchestration", () => {
    const now = () => new Date("2026-06-05T12:00:00Z");

    function buildRows(count: number, nudgedCount: number, prefix: string) {
      const rows: CoworkerTurnMetricRow[] = [];
      for (let i = 0; i < count; i++) {
        rows.push(
          metricRow({
            threadId: `${prefix}-t${i}`,
            agentMessageId: `${prefix}-m${i}`,
            nudges: i < nudgedCount ? 2 : 0,
          }),
        );
      }
      return rows;
    }

    it("files a nudge-rate PIR when the recent share spikes against a zero baseline", async () => {
      const fileReport = vi.fn(async () => {});
      const result = await detectCoworkerNudgeRateRegressions({
        now,
        // recent: 12 turns, 6 nudged -> 0.5 share; baseline: all clean -> 0.
        fetchTurnMetrics: async (from) =>
          from.getTime() >= now().getTime() - 60 * 60 * 1000
            ? buildRows(12, 6, "recent")
            : buildRows(20, 0, "base"),
        hasOpenDuplicate: async () => false,
        fileReport,
      });

      expect(result.filed).toBe(1);
      expect(fileReport).toHaveBeenCalledTimes(1);
      const arg = fileReport.mock.calls[0][0];
      expect(arg.title).toContain("nudge-rate regression");
      expect(arg.title).toContain("support-specialist");
      expect(arg.agentId).toBe("support-specialist");
      expect(arg.routeContext).toBe("/platform/ai");
      // Exemplar is one of the nudged turns.
      expect(arg.threadId).toMatch(/^recent-t/);
      expect(arg.severity).toBe("high"); // 0.5 share
    });

    it("skips filing when an open duplicate PIR already exists", async () => {
      const fileReport = vi.fn(async () => {});
      const result = await detectCoworkerNudgeRateRegressions({
        now,
        fetchTurnMetrics: async (from) =>
          from.getTime() >= now().getTime() - 60 * 60 * 1000
            ? buildRows(12, 6, "recent")
            : buildRows(20, 0, "base"),
        hasOpenDuplicate: async () => true,
        fileReport,
      });

      expect(result.filed).toBe(0);
      expect(result.skippedDuplicates).toBe(1);
      expect(fileReport).not.toHaveBeenCalled();
    });

    it("does not file when the recent nudge share is below threshold", async () => {
      const fileReport = vi.fn(async () => {});
      const result = await detectCoworkerNudgeRateRegressions({
        now,
        // recent share 1/12 ~= 0.083, below the 0.2 zero-baseline floor.
        fetchTurnMetrics: async (from) =>
          from.getTime() >= now().getTime() - 60 * 60 * 1000
            ? buildRows(12, 1, "recent")
            : buildRows(20, 0, "base"),
        hasOpenDuplicate: async () => false,
        fileReport,
      });

      expect(result.filed).toBe(0);
      expect(fileReport).not.toHaveBeenCalled();
    });
  });
});
