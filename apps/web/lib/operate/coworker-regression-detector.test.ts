import { describe, expect, it } from "vitest";
import {
  computeP95,
  groupDispatchRowsIntoTurns,
  shouldFileLatencyRegression,
} from "./coworker-regression-detector";

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
