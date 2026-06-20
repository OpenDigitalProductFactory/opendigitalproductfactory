import { describe, expect, it } from "vitest";

import { computeNextCronRun, isOneShotCron } from "./cron-next-run";

// `from` dates are built with the local Date constructor and assertions read
// local getters; computeNextCronRun uses the same host Date methods, so these
// tests are timezone-independent. Date month arg is 0-based (5 === June).

describe("computeNextCronRun — day-of-month (the BI-D72CC945 regression)", () => {
  it("Monthly `0 9 1 * *` from mid-month lands on the 1st of NEXT month, not tomorrow", () => {
    const from = new Date(2026, 5, 20, 10, 0, 0); // Sat Jun 20 2026, 10:00
    const next = computeNextCronRun("0 9 1 * *", from);
    expect(next.getFullYear()).toBe(2026);
    expect(next.getMonth()).toBe(6); // July
    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(9);
    expect(next.getMinutes()).toBe(0);
    expect(next.getSeconds()).toBe(0);
    // The pre-fix bug returned Jun 21 (tomorrow) — guard against regressing.
    expect(next.getMonth() === 5 && next.getDate() === 21).toBe(false);
  });

  it("Monthly fires the same day when the 1st's time is still ahead", () => {
    const from = new Date(2026, 5, 1, 8, 0, 0); // Jun 1, 08:00 (before 09:00)
    const next = computeNextCronRun("0 9 1 * *", from);
    expect(next.getMonth()).toBe(5); // June
    expect(next.getDate()).toBe(1);
    expect(next.getHours()).toBe(9);
  });

  it("Monthly rolls to next month once the 1st's time has passed", () => {
    const from = new Date(2026, 5, 1, 10, 0, 0); // Jun 1, 10:00 (after 09:00)
    const next = computeNextCronRun("0 9 1 * *", from);
    expect(next.getMonth()).toBe(6); // July
    expect(next.getDate()).toBe(1);
  });

  it("honors year rollover (Dec -> Jan)", () => {
    const from = new Date(2026, 11, 15, 12, 0, 0); // Dec 15 2026
    const next = computeNextCronRun("0 9 1 * *", from);
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(0); // January
    expect(next.getDate()).toBe(1);
  });
});

describe("computeNextCronRun — daily / weekly / weekday", () => {
  it("daily `0 9 * * *` advances to tomorrow once today's time passed", () => {
    const from = new Date(2026, 5, 20, 10, 0, 0);
    const next = computeNextCronRun("0 9 * * *", from);
    expect(next.getDate()).toBe(21);
    expect(next.getHours()).toBe(9);
  });

  it("daily fires today when the time is still ahead", () => {
    const from = new Date(2026, 5, 20, 8, 0, 0);
    const next = computeNextCronRun("0 9 * * *", from);
    expect(next.getDate()).toBe(20);
    expect(next.getHours()).toBe(9);
  });

  it("weekly `0 9 * * 0` lands on a Sunday in the future", () => {
    const from = new Date(2026, 5, 20, 10, 0, 0);
    const next = computeNextCronRun("0 9 * * 0", from);
    expect(next.getDay()).toBe(0); // Sunday
    expect(next.getHours()).toBe(9);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it("weekdays `30 8 * * 1-5` lands on a Mon–Fri at 08:30", () => {
    const from = new Date(2026, 5, 20, 10, 0, 0); // Saturday
    const next = computeNextCronRun("30 8 * * 1-5", from);
    expect(next.getDay()).toBeGreaterThanOrEqual(1);
    expect(next.getDay()).toBeLessThanOrEqual(5);
    expect(next.getHours()).toBe(8);
    expect(next.getMinutes()).toBe(30);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it("treats day-of-week 7 as Sunday", () => {
    const from = new Date(2026, 5, 20, 10, 0, 0);
    const next = computeNextCronRun("0 9 * * 7", from);
    expect(next.getDay()).toBe(0);
  });
});

describe("computeNextCronRun — specific month (Once preset) & union rule", () => {
  it("`0 9 5 7 *` (Jul 5) lands on the next July 5", () => {
    const from = new Date(2026, 5, 20, 10, 0, 0); // before Jul 5
    const next = computeNextCronRun("0 9 5 7 *", from);
    expect(next.getMonth()).toBe(6); // July
    expect(next.getDate()).toBe(5);
    expect(next.getFullYear()).toBe(2026);
  });

  it("`0 9 5 7 *` rolls to next year once the date has passed", () => {
    const from = new Date(2026, 7, 1, 10, 0, 0); // Aug 1, after Jul 5
    const next = computeNextCronRun("0 9 5 7 *", from);
    expect(next.getFullYear()).toBe(2027);
    expect(next.getMonth()).toBe(6);
    expect(next.getDate()).toBe(5);
  });

  it("applies the cron union rule when BOTH day-of-month and day-of-week are set", () => {
    const from = new Date(2026, 5, 1, 0, 0, 0);
    const next = computeNextCronRun("0 9 13 * 5", from); // 13th OR Friday
    expect(next.getDate() === 13 || next.getDay() === 5).toBe(true);
  });
});

describe("computeNextCronRun — malformed input", () => {
  it("falls back to ~24h ahead for a non-5-field expression", () => {
    const from = new Date(2026, 5, 20, 10, 0, 0);
    const next = computeNextCronRun("not a cron", from);
    const deltaH = (next.getTime() - from.getTime()) / 3_600_000;
    expect(deltaH).toBeCloseTo(24, 5);
  });
});

describe("isOneShotCron", () => {
  it("is true only when month AND day-of-month are pinned and dow is *", () => {
    expect(isOneShotCron("0 9 5 7 *")).toBe(true); // Once (Jul 5)
  });

  it("is false for recurring presets", () => {
    expect(isOneShotCron("0 9 1 * *")).toBe(false); // Monthly
    expect(isOneShotCron("0 9 * * 1")).toBe(false); // Weekly
    expect(isOneShotCron("30 8 * * 1-5")).toBe(false); // Weekdays
    expect(isOneShotCron("0 9 * * *")).toBe(false); // Daily
  });

  it("is false for malformed input", () => {
    expect(isOneShotCron("nope")).toBe(false);
  });
});
