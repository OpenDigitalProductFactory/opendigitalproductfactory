import { describe, expect, it } from "vitest";

import { isScheduledCheckDue, scheduledCheckEligibleAt } from "./interval-anchor";

// BI-EF1AC111, from the production evidence on the operator install: a nightly window opening at
// 23:00, scheduled runs on 11-02 and 11-03 at 23:02, a manual upgrade on 11-04
// at 13:48, and no run on the night of 11-04.
const OPENS_11_04 = new Date("2026-11-04T23:00:00.000Z");
const MANUAL_11_04 = new Date("2026-11-04T13:48:00.000Z");

describe("scheduled check interval anchored to the window", () => {
  it("AC-1: a daytime manual upgrade does not use up that night's window", () => {
    expect(isScheduledCheckDue(MANUAL_11_04, 24, OPENS_11_04, OPENS_11_04)).toBe(true);
  });

  it("AC-2: a run at 23:02 does not push the next night's 23:00 tick out", () => {
    const ranAt = new Date("2026-11-03T23:02:00.000Z");
    expect(isScheduledCheckDue(ranAt, 24, OPENS_11_04, OPENS_11_04)).toBe(true);
  });

  it("still allows one check per interval within the same opening", () => {
    const ranAt = new Date("2026-11-04T23:00:00.000Z");
    const nextTick = new Date("2026-11-05T00:00:00.000Z");
    expect(isScheduledCheckDue(ranAt, 24, nextTick, OPENS_11_04)).toBe(false);
    expect(scheduledCheckEligibleAt(ranAt, 24, OPENS_11_04)?.toISOString()).toBe("2026-11-05T23:00:00.000Z");
  });

  it("keeps a longer interval, landing on the opening nearest its due time", () => {
    const weekly = 168;
    const ranAt = new Date("2026-11-01T23:00:00.000Z");
    expect(isScheduledCheckDue(ranAt, weekly, OPENS_11_04, OPENS_11_04)).toBe(false);
    const opens11_07 = new Date("2026-11-07T23:00:00.000Z");
    expect(isScheduledCheckDue(ranAt, weekly, opens11_07, opens11_07)).toBe(true);
  });

  it("applies the plain interval when there is no bounded opening", () => {
    expect(isScheduledCheckDue(MANUAL_11_04, 24, OPENS_11_04, null)).toBe(false);
    expect(scheduledCheckEligibleAt(MANUAL_11_04, 24, null)?.toISOString()).toBe("2026-11-05T13:48:00.000Z");
  });

  it("does not throttle a first check or a non-positive interval", () => {
    expect(scheduledCheckEligibleAt(null, 24, OPENS_11_04)).toBeNull();
    expect(scheduledCheckEligibleAt(MANUAL_11_04, 0, OPENS_11_04)).toBeNull();
  });
});
