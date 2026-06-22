// BI-SCHED-ALLOCATE / EP-SCHEDULING-SURFACE — creation-time de-confliction tests.

import { describe, it, expect } from "vitest";

import { tickOf, occupiedTicks, deconflictCron } from "./scheduling-allocator";

describe("tickOf", () => {
  it("returns the HH:MM tick for a specific-time cron", () => {
    expect(tickOf("0 3 * * *")).toBe("03:00");
    expect(tickOf("10 3 * * *")).toBe("03:10");
    expect(tickOf("0 3 * * 0")).toBe("03:00"); // weekly still occupies 03:00
  });

  it("returns null for interval / frequent / null crons", () => {
    expect(tickOf("*/15 * * * *")).toBeNull();
    expect(tickOf("9,24,39,54 * * * *")).toBeNull();
    expect(tickOf(null)).toBeNull();
    expect(tickOf("daily")).toBeNull();
  });
});

describe("deconflictCron", () => {
  it("leaves a non-colliding specific-time cron unchanged", () => {
    const occ = occupiedTicks(["0 3 * * *"]);
    expect(deconflictCron("0 9 * * *", occ)).toEqual({ cron: "0 9 * * *", moved: false, note: null });
  });

  it("nudges a colliding cron to the nearest free minute and reports it", () => {
    const occ = occupiedTicks(["0 3 * * *", "10 3 * * *"]); // 03:00 and 03:10 taken
    const res = deconflictCron("0 3 * * *", occ); // wants 03:00 — taken
    expect(res.moved).toBe(true);
    expect(res.cron).toBe("1 3 * * *"); // nearest free is 03:01
    expect(res.note).toMatch(/03:00.*03:01/);
  });

  it("skips occupied minutes to find the next free one (preserves day fields)", () => {
    const occ = occupiedTicks(["0 3 * * *", "1 3 * * *", "2 3 * * *"]);
    const res = deconflictCron("0 3 5 6 *", occ); // a "Once" on Jun 5, 03:00
    expect(res.cron).toBe("3 3 5 6 *"); // 03:03, day-of-month/month preserved
  });

  it("passes interval cadences through untouched", () => {
    const occ = occupiedTicks(["*/15 * * * *"]);
    expect(deconflictCron("*/15 * * * *", occ).moved).toBe(false);
  });
});
