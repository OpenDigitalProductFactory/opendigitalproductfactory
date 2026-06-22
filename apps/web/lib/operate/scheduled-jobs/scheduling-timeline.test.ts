// BI-SCHED-TIMELINE / EP-SCHEDULING-SURFACE — daily-schedule model tests.

import { describe, it, expect } from "vitest";

import { fireProfile, buildTimelineModel } from "./scheduling-timeline";
import { SCHEDULING_MAP } from "./scheduling-map";

describe("fireProfile", () => {
  it("classifies a concrete daily time as timed", () => {
    expect(fireProfile("10 3 * * *")).toEqual({ kind: "timed", hour: 3, minute: 10, weekly: false });
  });

  it("flags a day-of-week restriction as weekly", () => {
    expect(fireProfile("0 3 * * 0")).toEqual({ kind: "timed", hour: 3, minute: 0, weekly: true });
  });

  it("classifies an every-hour cron as frequent", () => {
    expect(fireProfile("9,24,39,54 * * * *").kind).toBe("frequent");
    expect(fireProfile("*/15 * * * *").kind).toBe("frequent");
    expect(fireProfile("* * * * *").kind).toBe("frequent");
  });

  it("treats a null or non-cron token as unpinned", () => {
    expect(fireProfile(null).kind).toBe("unpinned");
    expect(fireProfile("daily").kind).toBe("unpinned");
  });
});

describe("buildTimelineModel", () => {
  it("places every map entry into exactly one of timed / frequent / unpinned", () => {
    const m = buildTimelineModel(SCHEDULING_MAP);
    const timed = m.hourBuckets.reduce((n, b) => n + b.jobs.length, 0);
    expect(timed + m.frequent.length + m.unpinned.length).toBe(SCHEDULING_MAP.length);
    expect(m.hourBuckets).toHaveLength(24);
  });

  it("buckets the 03:00 cluster (model-discovery + material-freshness land in hour 3)", () => {
    const m = buildTimelineModel(SCHEDULING_MAP);
    expect(m.maxBucket).toBeGreaterThanOrEqual(1);
    const hour3 = m.hourBuckets[3]!.jobs.map((j) => j.id);
    expect(hour3.some((id) => id.includes("model-discovery"))).toBe(true);
    expect(hour3.some((id) => id.includes("material-freshness"))).toBe(true);
  });
});
