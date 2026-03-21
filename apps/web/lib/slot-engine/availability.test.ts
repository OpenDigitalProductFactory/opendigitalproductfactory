import { describe, it, expect } from "vitest";
import { buildAvailabilityWindows } from "./availability";
import type { AvailabilityRow } from "./types";

describe("buildAvailabilityWindows", () => {
  it("returns windows from recurring weekly rule matching day-of-week", () => {
    const rows: AvailabilityRow[] = [
      { days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", date: null, isBlocked: false },
    ];
    const windows = buildAvailabilityWindows(rows, new Date("2026-03-23")); // Monday
    expect(windows).toEqual([{ startMinutes: 540, endMinutes: 1020 }]);
  });

  it("returns empty for day-of-week not in recurring rule", () => {
    const rows: AvailabilityRow[] = [
      { days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", date: null, isBlocked: false },
    ];
    const windows = buildAvailabilityWindows(rows, new Date("2026-03-22")); // Sunday
    expect(windows).toEqual([]);
  });

  it("date-specific override replaces recurring rules", () => {
    const targetDate = new Date("2026-03-23");
    const rows: AvailabilityRow[] = [
      { days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", date: null, isBlocked: false },
      { days: [], startTime: "10:00", endTime: "14:00", date: targetDate, isBlocked: false },
    ];
    const windows = buildAvailabilityWindows(rows, targetDate);
    expect(windows).toEqual([{ startMinutes: 600, endMinutes: 840 }]);
  });

  it("blocked date override returns empty", () => {
    const targetDate = new Date("2026-03-23");
    const rows: AvailabilityRow[] = [
      { days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", date: null, isBlocked: false },
      { days: [], startTime: "00:00", endTime: "00:00", date: targetDate, isBlocked: true },
    ];
    const windows = buildAvailabilityWindows(rows, targetDate);
    expect(windows).toEqual([]);
  });

  it("multiple recurring rules produce multiple windows", () => {
    const rows: AvailabilityRow[] = [
      { days: [1], startTime: "09:00", endTime: "12:00", date: null, isBlocked: false },
      { days: [1], startTime: "14:00", endTime: "18:00", date: null, isBlocked: false },
    ];
    const windows = buildAvailabilityWindows(rows, new Date("2026-03-23")); // Monday
    expect(windows).toEqual([
      { startMinutes: 540, endMinutes: 720 },
      { startMinutes: 840, endMinutes: 1080 },
    ]);
  });
});
