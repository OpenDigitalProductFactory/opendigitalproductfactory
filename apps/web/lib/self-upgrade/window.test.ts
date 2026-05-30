import { describe, expect, it } from "vitest";
import { isStoreOpen, isUpgradeWindowOpen, zonedDayAndTime } from "./window";
import type { WeeklySchedule } from "@/lib/operating-hours-types";

// 9–5 weekdays, closed weekends (the GENERIC_DEFAULTS shape / the user's "until 5PM").
const NINE_TO_FIVE: WeeklySchedule = {
  monday: { enabled: true, open: "09:00", close: "17:00" },
  tuesday: { enabled: true, open: "09:00", close: "17:00" },
  wednesday: { enabled: true, open: "09:00", close: "17:00" },
  thursday: { enabled: true, open: "09:00", close: "17:00" },
  friday: { enabled: true, open: "09:00", close: "17:00" },
  saturday: { enabled: false, open: "09:00", close: "17:00" },
  sunday: { enabled: false, open: "09:00", close: "17:00" },
};

// Reference instants in UTC. 2026-05-25 is a Monday; 2026-05-23 is a Saturday.
const MON_2300_UTC = new Date("2026-05-25T23:00:00Z");
const MON_1200_UTC = new Date("2026-05-25T12:00:00Z");
const SAT_1200_UTC = new Date("2026-05-23T12:00:00Z");

describe("zonedDayAndTime", () => {
  it("derives weekday + HH:mm in the given timezone", () => {
    expect(zonedDayAndTime(MON_2300_UTC, "UTC")).toEqual({ day: 1, hhmm: "23:00" });
  });
  it("shifts day/time across timezones", () => {
    // 23:00 UTC Monday is 19:00 Monday in New York (EDT, -4).
    expect(zonedDayAndTime(MON_2300_UTC, "America/New_York")).toEqual({ day: 1, hhmm: "19:00" });
    // 12:00 UTC Monday is 22:00 Monday in Tokyo (+9).
    expect(zonedDayAndTime(MON_1200_UTC, "Asia/Tokyo")).toEqual({ day: 1, hhmm: "21:00" });
  });
});

describe("isStoreOpen", () => {
  it("open during business hours on an enabled day", () => {
    expect(isStoreOpen(NINE_TO_FIVE, MON_1200_UTC, "UTC")).toBe(true);
  });
  it("closed in the evening (the 23:00 case the operator hit)", () => {
    expect(isStoreOpen(NINE_TO_FIVE, MON_2300_UTC, "UTC")).toBe(false);
  });
  it("closed all day on a disabled day (weekend)", () => {
    expect(isStoreOpen(NINE_TO_FIVE, SAT_1200_UTC, "UTC")).toBe(false);
  });
  it("respects timezone: 12:00 UTC is 21:00 (closed) in Tokyo", () => {
    expect(isStoreOpen(NINE_TO_FIVE, MON_1200_UTC, "Asia/Tokyo")).toBe(false);
  });
  it("handles an overnight span (18:00–02:00)", () => {
    const night: WeeklySchedule = { ...NINE_TO_FIVE, monday: { enabled: true, open: "18:00", close: "02:00" } };
    expect(isStoreOpen(night, MON_2300_UTC, "UTC")).toBe(true); // 23:00 within 18:00–02:00
    expect(isStoreOpen(night, MON_1200_UTC, "UTC")).toBe(false); // noon outside
  });
});

describe("isUpgradeWindowOpen", () => {
  it("ALLOWS at 23:00 on a weekday — store closed (fixes the reported bug)", () => {
    expect(isUpgradeWindowOpen({ schedule: NINE_TO_FIVE, timeZone: "UTC", now: MON_2300_UTC })).toBe(true);
  });
  it("BLOCKS during business hours — store open", () => {
    expect(isUpgradeWindowOpen({ schedule: NINE_TO_FIVE, timeZone: "UTC", now: MON_1200_UTC })).toBe(false);
  });
  it("ALLOWS on a closed weekend day", () => {
    expect(isUpgradeWindowOpen({ schedule: NINE_TO_FIVE, timeZone: "UTC", now: SAT_1200_UTC })).toBe(true);
  });
  it("explicit windows override the store-hours derivation", () => {
    // An explicit window that does NOT include Monday 23:00 → blocked even though closed.
    const windows = [{ dayOfWeek: [0], startTime: "00:00", endTime: "06:00" }];
    expect(isUpgradeWindowOpen({ explicitWindows: windows, schedule: NINE_TO_FIVE, now: MON_2300_UTC })).toBe(false);
  });
  it("no schedule and no windows → allowed (never silently block forever)", () => {
    expect(isUpgradeWindowOpen({ now: MON_1200_UTC })).toBe(true);
  });
});
