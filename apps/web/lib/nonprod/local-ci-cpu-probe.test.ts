// The local-CI CPU probe and the honesty of the observation recorded with a
// decision (BI-48F42581).

import { describe, expect, it } from "vitest";

import {
  cpuPercentBetween,
  sampleSustainedCpuPercent,
} from "./local-ci-capacity-broker";

describe("cpuPercentBetween", () => {
  it("reports the busy share of the interval, not a load average", () => {
    // 1000 ticks elapsed, 250 of them idle → 75% busy.
    expect(cpuPercentBetween({ idle: 0, total: 0 }, { idle: 250, total: 1000 }))
      .toBeCloseTo(75);
  });

  it("reports a fully idle interval as zero", () => {
    expect(cpuPercentBetween({ idle: 0, total: 0 }, { idle: 1000, total: 1000 }))
      .toBe(0);
  });

  it("reports a saturated interval as 100, and never above it", () => {
    expect(cpuPercentBetween({ idle: 5, total: 5 }, { idle: 5, total: 1005 }))
      .toBe(100);
  });

  it("is unmeasurable rather than idle when the clock did not advance", () => {
    // The old probe could only return a number. Returning 0 for "we did not
    // measure" would admit a gate onto a host nobody looked at; NaN routes to
    // host-cpu-unmeasurable, which closes the pool.
    expect(cpuPercentBetween({ idle: 10, total: 100 }, { idle: 10, total: 100 }))
      .toBeNaN();
    expect(cpuPercentBetween({ idle: 10, total: 100 }, { idle: 10, total: 50 }))
      .toBeNaN();
    expect(cpuPercentBetween(undefined, { idle: 0, total: 100 })).toBeNaN();
  });
});

describe("sampleSustainedCpuPercent", () => {
  it("measures across a window instead of reading a smoothed queue length", async () => {
    const snapshots = [
      { idle: 100, total: 200 },
      { idle: 140, total: 400 },
    ];
    let taken = 0;
    const delays: number[] = [];

    const percent = await sampleSustainedCpuPercent({
      snapshot: () => snapshots[taken++]!,
      delay: async (ms) => {
        delays.push(ms);
      },
      windowMs: 1_000,
    });

    // 200 ticks elapsed, 40 idle → 80% busy.
    expect(percent).toBeCloseTo(80);
    expect(taken).toBe(2);
    expect(delays).toEqual([1_000]);
  });

  it("does not report a host it never sampled twice as idle", async () => {
    const frozen = { idle: 100, total: 200 };
    const percent = await sampleSustainedCpuPercent({
      snapshot: () => frozen,
      delay: async () => {},
    });
    expect(percent).toBeNaN();
  });

  it("the live probe returns a real percentage", async () => {
    // Guards the wiring: the exported default path must still measure something
    // in [0, 100] on the machine running the suite.
    const percent = await sampleSustainedCpuPercent({ windowMs: 50 });
    expect(Number.isFinite(percent)).toBe(true);
    expect(percent).toBeGreaterThanOrEqual(0);
    expect(percent).toBeLessThanOrEqual(100);
  });
});
