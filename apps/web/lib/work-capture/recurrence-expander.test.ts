import { describe, expect, it } from "vitest";
import { expandOccurrences, parseRRule, wallClockToUtc } from "./recurrence-expander";

const NY = "America/New_York";

/** Format a UTC instant as wall-clock in a tz for assertions. */
function inTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz, weekday: "short", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(d);
}
function utcHour(d: Date): number {
  return d.getUTCHours();
}

describe("parseRRule", () => {
  it("parses the supported subset", () => {
    expect(parseRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5")).toEqual({
      freq: "WEEKLY", interval: 2, byday: ["MO", "WE"], count: 5, until: null,
    });
  });
  it("rejects unsupported FREQ", () => {
    expect(() => parseRRule("FREQ=YEARLY")).toThrow(/Unsupported FREQ/);
  });
  it("rejects both COUNT and UNTIL", () => {
    expect(() => parseRRule("FREQ=DAILY;COUNT=3;UNTIL=20260101")).toThrow(/must not set both/);
  });
  it("parses RFC-5545 basic UTC UNTIL", () => {
    expect(parseRRule("FREQ=DAILY;UNTIL=20260115T000000Z").until?.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });
});

describe("wallClockToUtc (DST-correct)", () => {
  it("maps a winter (EST) wall-clock to UTC-5", () => {
    // 2026-01-15 09:00 America/New_York = 14:00 UTC (EST).
    expect(wallClockToUtc(2026, 0, 15, 9, 0, 0, NY).toISOString()).toBe("2026-01-15T14:00:00.000Z");
  });
  it("maps a summer (EDT) wall-clock to UTC-4", () => {
    // 2026-07-15 09:00 America/New_York = 13:00 UTC (EDT).
    expect(wallClockToUtc(2026, 6, 15, 9, 0, 0, NY).toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });
});

describe("expandOccurrences", () => {
  it("DST: a weekly Monday 09:00 NY cadence stays 09:00 local across spring-forward", () => {
    // Anchor 2026-02-02 09:00 EST (= 14:00Z). Spring-forward is 2026-03-08.
    const occ = expandOccurrences({
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      timezone: NY,
      anchorAt: new Date("2026-02-02T14:00:00.000Z"),
      until: null,
      windowStart: new Date("2026-02-01T00:00:00.000Z"),
      windowEnd: new Date("2026-04-01T00:00:00.000Z"),
      maxOccurrences: 100,
    });
    expect(occ.length).toBeGreaterThan(4);
    // Every occurrence is a Monday at 09:00 LOCAL — the wall clock never drifts.
    for (const o of occ) {
      const s = inTz(o.occurrenceAt, NY);
      expect(s).toContain("Mon");
      expect(s).toContain("09:00");
    }
    // But the UTC hour SHIFTS across the DST boundary: EST Mondays are 14:00Z,
    // EDT Mondays (after Mar 8) are 13:00Z. Proves tz-aware (not naive) expansion.
    const feb = occ.find((o) => o.occurrenceAt < new Date("2026-03-08T00:00:00Z"))!;
    const mar = occ.find((o) => o.occurrenceAt > new Date("2026-03-09T00:00:00Z"))!;
    expect(utcHour(feb.occurrenceAt)).toBe(14);
    expect(utcHour(mar.occurrenceAt)).toBe(13);
  });

  it("honours COUNT and assigns 1-based instanceNumbers", () => {
    const occ = expandOccurrences({
      rrule: "FREQ=DAILY;COUNT=3",
      timezone: "UTC",
      anchorAt: new Date("2026-05-01T08:00:00.000Z"),
      until: null,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-06-01T00:00:00.000Z"),
      maxOccurrences: 100,
    });
    expect(occ.map((o) => o.occurrenceAt.toISOString())).toEqual([
      "2026-05-01T08:00:00.000Z",
      "2026-05-02T08:00:00.000Z",
      "2026-05-03T08:00:00.000Z",
    ]);
    expect(occ.map((o) => o.instanceNumber)).toEqual([1, 2, 3]);
  });

  it("respects INTERVAL for weekly", () => {
    const occ = expandOccurrences({
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=3",
      timezone: "UTC",
      anchorAt: new Date("2026-05-04T10:00:00.000Z"), // Mon
      until: null,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-08-01T00:00:00.000Z"),
      maxOccurrences: 100,
    });
    const days = occ.map((o) => o.occurrenceAt.toISOString().slice(0, 10));
    expect(days).toEqual(["2026-05-04", "2026-05-18", "2026-06-01"]); // every 2nd Monday
  });

  it("expands monthly on the anchor day-of-month", () => {
    const occ = expandOccurrences({
      rrule: "FREQ=MONTHLY;COUNT=3",
      timezone: "UTC",
      anchorAt: new Date("2026-01-15T12:00:00.000Z"),
      until: null,
      windowStart: new Date("2026-01-01T00:00:00.000Z"),
      windowEnd: new Date("2026-12-01T00:00:00.000Z"),
      maxOccurrences: 100,
    });
    expect(occ.map((o) => o.occurrenceAt.toISOString().slice(0, 10))).toEqual([
      "2026-01-15", "2026-02-15", "2026-03-15",
    ]);
  });

  it("caps at maxOccurrences for an unbounded rule (never expands the rule to infinity)", () => {
    const occ = expandOccurrences({
      rrule: "FREQ=DAILY", // no COUNT/UNTIL — open-ended
      timezone: "UTC",
      anchorAt: new Date("2026-01-01T00:00:00.000Z"),
      until: null,
      windowStart: new Date("2026-01-01T00:00:00.000Z"),
      windowEnd: new Date("2030-01-01T00:00:00.000Z"),
      maxOccurrences: 10,
    });
    expect(occ).toHaveLength(10);
  });

  it("filters to the window and honours schedule-level until", () => {
    const occ = expandOccurrences({
      rrule: "FREQ=DAILY",
      timezone: "UTC",
      anchorAt: new Date("2026-05-01T00:00:00.000Z"),
      until: new Date("2026-05-05T00:00:00.000Z"),
      windowStart: new Date("2026-05-03T00:00:00.000Z"),
      windowEnd: new Date("2026-05-10T00:00:00.000Z"),
      maxOccurrences: 100,
    });
    // anchor 5/1, until 5/5, window starts 5/3 → 5/3, 5/4, 5/5.
    expect(occ.map((o) => o.occurrenceAt.toISOString().slice(0, 10))).toEqual([
      "2026-05-03", "2026-05-04", "2026-05-05",
    ]);
  });
});
