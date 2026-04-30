// apps/web/lib/orchestration/heartbeat.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startHeartbeat, noteActivity, stopHeartbeat } from "./heartbeat";

describe("heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onTick after heartbeatMs of quiet", () => {
    const onTick = vi.fn();
    startHeartbeat("run-1", 1000, onTick);
    vi.advanceTimersByTime(1000);
    expect(onTick).toHaveBeenCalledTimes(1);
    stopHeartbeat("run-1");
  });

  it("noteActivity resets the quiet timer", () => {
    const onTick = vi.fn();
    startHeartbeat("run-2", 1000, onTick);
    vi.advanceTimersByTime(700);
    noteActivity("run-2");
    vi.advanceTimersByTime(700);
    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onTick).toHaveBeenCalledTimes(1);
    stopHeartbeat("run-2");
  });

  it("stopHeartbeat clears the timer; subsequent advance does not fire", () => {
    const onTick = vi.fn();
    startHeartbeat("run-3", 1000, onTick);
    stopHeartbeat("run-3");
    vi.advanceTimersByTime(5000);
    expect(onTick).not.toHaveBeenCalled();
  });

  it("multiple runs are scoped independently by runId", () => {
    const tickA = vi.fn();
    const tickB = vi.fn();
    startHeartbeat("a", 1000, tickA);
    startHeartbeat("b", 1000, tickB);
    vi.advanceTimersByTime(500);
    noteActivity("a");
    vi.advanceTimersByTime(600);
    expect(tickA).not.toHaveBeenCalled();
    expect(tickB).toHaveBeenCalledTimes(1);
    stopHeartbeat("a");
    stopHeartbeat("b");
  });

  it("starting a second heartbeat for the same runId replaces the first", () => {
    const tick1 = vi.fn();
    const tick2 = vi.fn();
    startHeartbeat("r", 1000, tick1);
    startHeartbeat("r", 1000, tick2);
    vi.advanceTimersByTime(1500);
    expect(tick1).not.toHaveBeenCalled();
    expect(tick2).toHaveBeenCalledTimes(1);
    stopHeartbeat("r");
  });
});
