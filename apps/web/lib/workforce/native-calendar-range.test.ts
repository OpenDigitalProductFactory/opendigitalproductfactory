import { describe, expect, it } from "vitest";
import { nativeCalendarRangeWhere, readNativeCalendarCivilRange } from "./native-calendar-range";

const start = new Date("2026-10-29T05:00:00Z");
const end = new Date("2026-10-30T05:00:00Z");
describe("native calendar civil range", () => {
  it.each([
    [null, null, undefined],
    ["2026-10-29", null, null],
    ["2026-02-30", "2026-03-01", null],
    ["2026-10-30", "2026-10-29", null],
    ["2026-10-29T00:00:00Z", "2026-10-30", null],
  ])("validates date-only boundaries %s / %s", (a, b, expected) => {
    expect(readNativeCalendarCivilRange(a, b, start, end)).toBe(expected);
  });
  it("preserves the instant predicate for timed and synced rows", () => {
    const civil = readNativeCalendarCivilRange("2026-10-29", "2026-10-30", start, end)!;
    const original = nativeCalendarRangeWhere(start, end);
    const ranged = nativeCalendarRangeWhere(start, end, civil);
    expect(ranged.OR?.[1]).toEqual({ AND: [
      { OR: [{ allDay: false }, { syncSource: { not: null } }] }, original,
    ] });
    expect(ranged.OR?.[0]).toMatchObject({ allDay: true, syncSource: null,
      startAt: { lt: new Date("2026-10-30T00:00:00Z") } });
  });
});
