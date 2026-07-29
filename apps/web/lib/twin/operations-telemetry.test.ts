import { describe, expect, it, vi } from "vitest";

import {
  createOperationsInteractionMeasure,
  formatOperationsServerTiming,
  markOperationsDecisionSurfaceReady,
  summarizeOperationsLatency,
} from "./operations-telemetry";

describe("operations latency telemetry", () => {
  it("reports nearest-rank p50, p75, and p95 without averaging away tail latency", () => {
    expect(summarizeOperationsLatency([50, 75, 90, 100, 120, 150, 180, 220])).toEqual({
      count: 8,
      minMs: 50,
      maxMs: 220,
      p50Ms: 100,
      p75Ms: 150,
      p95Ms: 220,
    });
  });

  it("emits a valid Server-Timing value for the current-state read", () => {
    expect(formatOperationsServerTiming({ durationMs: 123.456, queryCount: 9 })).toBe(
      'operations;dur=123.5;desc="current-state read";queries=9',
    );
  });

  it("marks immediate interaction start and measures confirmation latency", () => {
    const mark = vi.fn();
    const measure = vi.fn();
    const perf = { mark, measure };

    const finish = createOperationsInteractionMeasure(perf, "assign", "cmd-1");
    finish("confirmed");

    expect(mark).toHaveBeenNthCalledWith(1, "dpf.operations.assign.cmd-1.start");
    expect(mark).toHaveBeenNthCalledWith(2, "dpf.operations.assign.cmd-1.confirmed");
    expect(measure).toHaveBeenCalledWith(
      "dpf.operations.assign.confirmed",
      "dpf.operations.assign.cmd-1.start",
      "dpf.operations.assign.cmd-1.confirmed",
    );
  });

  it("marks the first useful Operations decision surface once", () => {
    const mark = vi.fn();
    const getEntriesByName = vi
      .fn()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{ name: "dpf.operations.decision-surface.ready" }]);
    const perf = { mark, getEntriesByName };

    markOperationsDecisionSurfaceReady(perf);
    markOperationsDecisionSurfaceReady(perf);

    expect(mark).toHaveBeenCalledTimes(1);
    expect(mark).toHaveBeenCalledWith("dpf.operations.decision-surface.ready");
  });
});
