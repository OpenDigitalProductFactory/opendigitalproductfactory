import { describe, expect, it } from "vitest";

import {
  formatRetentionBuckets,
  formatRetentionDuration,
  formatRetentionMinimum,
} from "./format-retention-minimum";

describe("formatRetentionDuration", () => {
  it("states a whole number of years the way a regulator does", () => {
    expect(formatRetentionDuration(7 * 365)).toBe("7 years");
    expect(formatRetentionDuration(365)).toBe("1 year");
  });

  it("keeps days rather than rounding a legal minimum into years", () => {
    expect(formatRetentionDuration(400)).toBe("400 days");
    expect(formatRetentionDuration(90)).toBe("90 days");
    expect(formatRetentionDuration(1)).toBe("1 day");
  });

  it("groups thousands so a long duration stays readable", () => {
    expect(formatRetentionDuration(2000)).toBe("2,000 days");
  });

  it("returns null when the obligation states no minimum", () => {
    expect(formatRetentionDuration(null)).toBeNull();
    expect(formatRetentionDuration(undefined)).toBeNull();
    expect(formatRetentionDuration(0)).toBeNull();
    expect(formatRetentionDuration(-5)).toBeNull();
    expect(formatRetentionDuration(Number.NaN)).toBeNull();
  });
});

describe("formatRetentionBuckets", () => {
  it("lists the categories the minimum binds", () => {
    expect(formatRetentionBuckets(["audit", "chat"])).toBe("audit, chat");
  });

  // Must match foldObligationFloors: an obligation naming no bucket binds every
  // bucket. Describing that as anything narrower would understate the sweep.
  it("reads an unnamed set as every category, matching the sweep", () => {
    expect(formatRetentionBuckets([])).toBe("all categories");
    expect(formatRetentionBuckets(null)).toBe("all categories");
    expect(formatRetentionBuckets(undefined)).toBe("all categories");
  });
});

describe("formatRetentionMinimum", () => {
  it("renders duration and scope on one line", () => {
    expect(
      formatRetentionMinimum({ retentionMinimumDays: 2555, retentionFloorBuckets: ["audit", "chat"] }),
    ).toBe("7 years · audit, chat");
  });

  it("omits the tile entirely when there is no stated minimum", () => {
    expect(formatRetentionMinimum({ retentionMinimumDays: null, retentionFloorBuckets: ["audit"] })).toBeNull();
  });

  // Text mass is measured by the route's UX-fit manifest. The tile is a label
  // plus a short value; an explanatory sentence here would regress the route.
  it("stays terse enough for the metadata tile", () => {
    const line = formatRetentionMinimum({ retentionMinimumDays: 365, retentionFloorBuckets: ["telemetry"] });
    expect(line).toBe("1 year · telemetry");
    expect(line!.split(" ").length).toBeLessThanOrEqual(5);
  });
});
