import { describe, expect, it } from "vitest";

import { isWithinWindows, nextOpeningAfter, openingStartedAt } from "./windows-eval";

// BI-EF1AC111: the opening a scheduled check is anchored to.
const NIGHTLY = [{ dayOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "23:00", endTime: "05:00" }];
const open = (at: Date) => isWithinWindows(NIGHTLY, at, "UTC");

describe("window openings", () => {
  it("finds when the current overnight opening began", () => {
    expect(openingStartedAt(open, new Date("2026-11-05T02:30:15.000Z"))?.toISOString())
      .toBe("2026-11-04T23:00:00.000Z");
    expect(openingStartedAt(open, new Date("2026-11-04T23:00:00.000Z"))?.toISOString())
      .toBe("2026-11-04T23:00:00.000Z");
  });

  it("returns null while closed or when the window never closes", () => {
    expect(openingStartedAt(open, new Date("2026-11-04T13:48:00.000Z"))).toBeNull();
    expect(openingStartedAt(() => true, new Date("2026-11-04T13:48:00.000Z"))).toBeNull();
  });

  it("finds the opening after the current one", () => {
    expect(nextOpeningAfter(open, new Date("2026-11-04T23:30:00.000Z"))?.toISOString())
      .toBe("2026-11-05T23:00:00.000Z");
    expect(nextOpeningAfter(open, new Date("2026-11-04T13:48:00.000Z"))?.toISOString())
      .toBe("2026-11-04T23:00:00.000Z");
    expect(nextOpeningAfter(() => true, new Date("2026-11-04T13:48:00.000Z"))).toBeNull();
  });
});
