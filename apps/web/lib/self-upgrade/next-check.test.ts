import { describe, expect, it } from "vitest";

import { computeNextScheduledUpgradeCheckAt } from "./next-check";

// BI-EF1AC111: the panel's "next scheduled check" follows the window-anchored
// interval, so it shows tonight's window after a daytime manual upgrade.
const base = { enabled: true, checkIntervalHours: 24 };

describe("computeNextScheduledUpgradeCheckAt", () => {
  it("reports tonight's window after a daytime manual upgrade", () => {
    const next = computeNextScheduledUpgradeCheckAt({
      ...base,
      inMaintenanceWindow: false,
      nextWindowStart: new Date("2026-11-04T23:00:00.000Z"),
      lastCheckedAt: new Date("2026-11-04T13:48:00.000Z"),
      now: new Date("2026-11-04T14:10:00.000Z"),
    });
    expect(next?.toISOString()).toBe("2026-11-04T23:00:00.000Z");
  });

  it("reports the following opening once this opening has had its check", () => {
    const next = computeNextScheduledUpgradeCheckAt({
      ...base,
      inMaintenanceWindow: true,
      nextWindowStart: null,
      lastCheckedAt: new Date("2026-11-04T23:02:00.000Z"),
      now: new Date("2026-11-05T00:10:00.000Z"),
      windowOpenedAt: new Date("2026-11-04T23:00:00.000Z"),
      followingWindowStart: new Date("2026-11-05T23:00:00.000Z"),
    });
    expect(next?.toISOString()).toBe("2026-11-05T23:00:00.000Z");
  });

  it("reports the next tick while an opening still owes its check", () => {
    const next = computeNextScheduledUpgradeCheckAt({
      ...base,
      inMaintenanceWindow: true,
      nextWindowStart: null,
      lastCheckedAt: new Date("2026-11-04T13:48:00.000Z"),
      now: new Date("2026-11-04T23:20:00.000Z"),
      windowOpenedAt: new Date("2026-11-04T23:00:00.000Z"),
      followingWindowStart: new Date("2026-11-05T23:00:00.000Z"),
    });
    expect(next?.toISOString()).toBe("2026-11-05T00:00:00.000Z");
  });
});
