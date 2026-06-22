import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERNIGHT_WINDOW,
  describeWindows,
  formatWindowClock,
  isEffectively247,
  nextAutoWindowOpen,
  pickOvernightWindow,
  resolveAutoUpgradeWindow,
  selectTroughWindows,
  type LowTrafficWindow,
} from "./auto-window";
import { isWithinWindows } from "./windows-eval";
import { isHeavyMaintenanceBusyAtUtc } from "./maintenance-calendar";
import type { WeeklySchedule } from "@/lib/operating-hours-types";

// A genuine 24/7 store: every day open 00:00-24:00 (isStoreOpen always true), so
// the operating-hours model never opens a window. Matches window.test.ts.
const ALL_DAY: WeeklySchedule = {
  monday: { enabled: true, open: "00:00", close: "24:00" },
  tuesday: { enabled: true, open: "00:00", close: "24:00" },
  wednesday: { enabled: true, open: "00:00", close: "24:00" },
  thursday: { enabled: true, open: "00:00", close: "24:00" },
  friday: { enabled: true, open: "00:00", close: "24:00" },
  saturday: { enabled: true, open: "00:00", close: "24:00" },
  sunday: { enabled: true, open: "00:00", close: "24:00" },
};

const NINE_TO_FIVE: WeeklySchedule = {
  monday: { enabled: true, open: "09:00", close: "17:00" },
  tuesday: { enabled: true, open: "09:00", close: "17:00" },
  wednesday: { enabled: true, open: "09:00", close: "17:00" },
  thursday: { enabled: true, open: "09:00", close: "17:00" },
  friday: { enabled: true, open: "09:00", close: "17:00" },
  saturday: { enabled: false, open: "09:00", close: "17:00" },
  sunday: { enabled: false, open: "09:00", close: "17:00" },
};

// 2026-05-25 is a Monday.
const MON_1200_UTC = new Date("2026-05-25T12:00:00Z");
// 08:00 UTC Monday = 03:00 Monday in US Central (CDT, -5) — inside 02:00-04:00 local.
const MON_0800_UTC = new Date("2026-05-25T08:00:00Z");

describe("isEffectively247", () => {
  it("is true for a store that never closes (open 00:00-24:00 every day)", () => {
    expect(isEffectively247(ALL_DAY, MON_1200_UTC, "UTC")).toBe(true);
  });

  it("is false for a 9-5 store (it closes every evening)", () => {
    expect(isEffectively247(NINE_TO_FIVE, MON_1200_UTC, "UTC")).toBe(false);
  });

  it("is false when even one day has real closed hours (not truly 24/7)", () => {
    const almost: WeeklySchedule = {
      ...ALL_DAY,
      sunday: { enabled: false, open: "00:00", close: "24:00" },
    };
    expect(isEffectively247(almost, MON_1200_UTC, "UTC")).toBe(false);
  });
});

describe("resolveAutoUpgradeWindow", () => {
  it("returns operating-hours for a non-24/7 store", () => {
    const r = resolveAutoUpgradeWindow({
      schedule: NINE_TO_FIVE,
      timeZone: "America/Chicago",
      timezoneKnown: true,
      now: MON_1200_UTC,
    });
    expect(r).toEqual({ kind: "operating-hours" });
  });

  it("auto-picks the default overnight window for a 24/7 store with a known timezone", () => {
    const r = resolveAutoUpgradeWindow({
      schedule: ALL_DAY,
      timeZone: "America/Chicago",
      timezoneKnown: true,
      now: MON_1200_UTC,
    });
    expect(r).toEqual({
      kind: "auto-overnight",
      source: "default",
      windows: [DEFAULT_OVERNIGHT_WINDOW],
    });
  });

  it("shifts the overnight window off the 03:00-04:00 UTC maintenance cluster for a UTC store (BI-963B9D47)", () => {
    // For a UTC store, the default 02:00-04:00 local IS 02:00-04:00 UTC, which
    // overlaps the backup/maintenance cluster — so it shifts to the first clear
    // candidate, 01:00-03:00.
    const r = resolveAutoUpgradeWindow({
      schedule: ALL_DAY,
      timeZone: "UTC",
      timezoneKnown: true,
      now: MON_1200_UTC,
    });
    expect(r).toMatchObject({
      kind: "auto-overnight",
      source: "default",
      windows: [{ startTime: "01:00", endTime: "03:00" }],
    });
  });

  it("asks for a timezone when the store is 24/7 but no timezone is known", () => {
    const r = resolveAutoUpgradeWindow({
      schedule: ALL_DAY,
      timeZone: "UTC",
      timezoneKnown: false,
      now: MON_1200_UTC,
    });
    expect(r).toEqual({ kind: "needs-timezone" });
  });

  it("prefers a valid observed low-traffic trough over the default", () => {
    const lowTrafficWindows: LowTrafficWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      dayOfWeek: d,
      start: "03:00",
      end: "05:00",
    }));
    const r = resolveAutoUpgradeWindow({
      schedule: ALL_DAY,
      timeZone: "America/Chicago",
      timezoneKnown: true,
      lowTrafficWindows,
      now: MON_1200_UTC,
    });
    expect(r).toEqual({
      kind: "auto-overnight",
      source: "trough",
      windows: [{ dayOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "03:00", endTime: "05:00" }],
    });
  });

  it("falls back to the default when the only troughs are the malformed 24/7-derived artifacts", () => {
    // deriveLowTrafficWindows emits {start:"24:00", end:"23:59"} for a 24/7 day.
    const lowTrafficWindows: LowTrafficWindow[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      dayOfWeek: d,
      start: "24:00",
      end: "23:59",
    }));
    const r = resolveAutoUpgradeWindow({
      schedule: ALL_DAY,
      timeZone: "America/Chicago",
      timezoneKnown: true,
      lowTrafficWindows,
      now: MON_1200_UTC,
    });
    expect(r).toMatchObject({ kind: "auto-overnight", source: "default" });
  });
});

describe("selectTroughWindows", () => {
  it("groups identical ranges across days into one window", () => {
    const windows = selectTroughWindows([
      { dayOfWeek: 1, start: "02:00", end: "04:00" },
      { dayOfWeek: 2, start: "02:00", end: "04:00" },
    ]);
    expect(windows).toEqual([{ dayOfWeek: [1, 2], startTime: "02:00", endTime: "04:00" }]);
  });

  it("rejects malformed times (hour > 23), zero-length, and over-long (> 6h) slots", () => {
    expect(selectTroughWindows([{ dayOfWeek: 1, start: "24:00", end: "23:59" }])).toBeNull();
    expect(selectTroughWindows([{ dayOfWeek: 1, start: "03:00", end: "03:00" }])).toBeNull();
    // 00:00-08:00 is 8h > 6h cap.
    expect(selectTroughWindows([{ dayOfWeek: 1, start: "00:00", end: "08:00" }])).toBeNull();
    // out-of-range day index.
    expect(selectTroughWindows([{ dayOfWeek: 9, start: "02:00", end: "04:00" }])).toBeNull();
  });

  it("accepts an overnight quiet slot that wraps midnight (23:00-02:00 = 3h)", () => {
    const windows = selectTroughWindows([{ dayOfWeek: 6, start: "23:00", end: "02:00" }]);
    expect(windows).toEqual([{ dayOfWeek: [6], startTime: "23:00", endTime: "02:00" }]);
  });
});

describe("nextAutoWindowOpen", () => {
  it("returns the next 02:00 local for the default overnight window", () => {
    // Monday noon UTC, window 02:00-04:00 every day in UTC -> next open Tue 02:00 UTC.
    const next = nextAutoWindowOpen([DEFAULT_OVERNIGHT_WINDOW], MON_1200_UTC, "UTC");
    expect(next?.toISOString()).toBe("2026-05-26T02:00:00.000Z");
  });

  it("returns `now` when currently inside the window, evaluated in the store timezone", () => {
    // 08:00 UTC = 03:00 US Central, inside 02:00-04:00 local.
    const next = nextAutoWindowOpen([DEFAULT_OVERNIGHT_WINDOW], MON_0800_UTC, "America/Chicago");
    expect(next).toBe(MON_0800_UTC);
  });
});

describe("formatWindowClock / describeWindows", () => {
  it("formats 24h HH:mm as 12h clock", () => {
    expect(formatWindowClock("02:00")).toBe("2:00 AM");
    expect(formatWindowClock("00:00")).toBe("12:00 AM");
    expect(formatWindowClock("12:00")).toBe("12:00 PM");
    expect(formatWindowClock("13:30")).toBe("1:30 PM");
  });

  it("describes the default overnight window as a friendly range", () => {
    expect(describeWindows([DEFAULT_OVERNIGHT_WINDOW])).toBe("2:00 AM–4:00 AM");
  });
});

describe("pickOvernightWindow (avoids platform heavy maintenance, BI-963B9D47)", () => {
  it("keeps 02:00-04:00 when it is clear (US-Central: 02:00-04:00 local = 07:00-09:00 UTC)", () => {
    const w = pickOvernightWindow({ timeZone: "America/Chicago", now: MON_1200_UTC });
    expect(w).toMatchObject({ startTime: "02:00", endTime: "04:00" });
  });

  it("shifts earlier for a UTC store whose 02:00-04:00 hits the 03:00-04:00 UTC cluster", () => {
    const w = pickOvernightWindow({ timeZone: "UTC", now: MON_1200_UTC });
    expect(w).toMatchObject({ startTime: "01:00", endTime: "03:00" });
  });

  it("never returns a window overlapping heavy maintenance, across timezones (invariant)", () => {
    // Half-hour and whole-hour offsets, both hemispheres.
    for (const tz of ["UTC", "America/Chicago", "Europe/London", "Asia/Kolkata", "Asia/Tokyo"]) {
      const w = pickOvernightWindow({ timeZone: tz, now: MON_1200_UTC });
      let overlap = 0;
      const limit = MON_1200_UTC.getTime() + 7 * 24 * 60 * 60 * 1000;
      for (let t = MON_1200_UTC.getTime(); t <= limit; t += 30 * 60_000) {
        const probe = new Date(t);
        if (isWithinWindows([w], probe, tz) && isHeavyMaintenanceBusyAtUtc(probe)) overlap++;
      }
      expect(overlap).toBe(0);
    }
  });
});
