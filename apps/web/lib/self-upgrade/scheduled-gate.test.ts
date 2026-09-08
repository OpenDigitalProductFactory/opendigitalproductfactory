import { describe, expect, it } from "vitest";

import { isCheckIntervalElapsed } from "./last-check";
import {
  declineIsCurrent,
  nextScheduledCheckAt,
  scheduledCheckIsThrottled,
} from "./scheduled-gate";

const NOW = new Date("2026-09-07T07:04:00Z");
// The live values that produced BI-3CA18934.
const LAST_CHECKED = new Date("2026-09-07T05:39:09.895Z");

describe("nextScheduledCheckAt", () => {
  it("BI-3CA18934: reports the next unattended check a full interval after the last one", () => {
    expect(nextScheduledCheckAt(LAST_CHECKED, 24, NOW)?.toISOString())
      .toBe("2026-09-08T05:39:09.895Z");
  });

  it("is null when a check has never run", () => {
    expect(nextScheduledCheckAt(null, 24, NOW)).toBeNull();
  });

  it("is null when the interval is non-positive (no throttle)", () => {
    expect(nextScheduledCheckAt(LAST_CHECKED, 0, NOW)).toBeNull();
  });

  it("is null once the interval has elapsed", () => {
    const after = new Date("2026-09-08T06:00:00Z");
    expect(nextScheduledCheckAt(LAST_CHECKED, 24, after)).toBeNull();
  });

  it("never disagrees with the gate the cron actually applies", () => {
    const cases: Array<[Date | null, number, Date]> = [
      [LAST_CHECKED, 24, NOW],
      [LAST_CHECKED, 24, new Date("2026-09-08T05:39:09.895Z")],
      [LAST_CHECKED, 1, NOW],
      [null, 24, NOW],
      [LAST_CHECKED, -1, NOW],
    ];
    for (const [last, hours, now] of cases) {
      expect(scheduledCheckIsThrottled(last, hours, now))
        .toBe(!isCheckIntervalElapsed(last, hours, now));
    }
  });
});

describe("declineIsCurrent", () => {
  it("keeps a decline recorded after the last successful check", () => {
    expect(declineIsCurrent(
      { reason: "interval-not-elapsed", at: "2026-09-07T07:00:00Z" },
      LAST_CHECKED,
    )).toBe(true);
  });

  it("BI-3CA18934: drops a decline that predates the last check (the throttle lifted)", () => {
    expect(declineIsCurrent(
      { reason: "outside-window", at: "2026-09-07T04:00:00Z" },
      LAST_CHECKED,
    )).toBe(false);
  });

  it("is false with no decline, and tolerates a malformed timestamp", () => {
    expect(declineIsCurrent(null, LAST_CHECKED)).toBe(false);
    expect(declineIsCurrent({ reason: "cooldown", at: "not-a-date" }, LAST_CHECKED)).toBe(false);
  });
});
