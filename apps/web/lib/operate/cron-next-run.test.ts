import { describe, expect, it } from "vitest";

import { computeNextCronFire, computeNextCronRun, isOneShotCron, parseCronSchedule } from "./cron-next-run";

describe("BI-0A82D3B4 shared agent-task UTC projection", () => {
  it("keeps every six-hour fire and day rollover instead of falling back to 24 hours", () => {
    let from = new Date("2026-10-18T19:44:22.832Z");
    for (const expected of [
      "2026-10-19T00:23:00.000Z",
      "2026-10-19T06:23:00.000Z",
      "2026-10-19T12:23:00.000Z",
      "2026-10-19T18:23:00.000Z",
      "2026-10-20T00:23:00.000Z",
    ]) {
      from = computeNextCronRun("23 */6 * * *", from);
      expect(from.toISOString()).toBe(expected);
    }
  });

  it.each([
    ["23 * * * *", "2026-10-18T20:23:00.000Z"],
    ["23 0,6,12,18 * * *", "2026-10-19T00:23:00.000Z"],
    ["23 18-23 * * *", "2026-10-18T20:23:00.000Z"],
  ])("projects %s with the existing full evaluator's UTC semantics", (cron, expected) => {
    expect(computeNextCronRun(cron, new Date("2026-10-18T19:44:22.832Z")).toISOString()).toBe(expected);
  });

  it.each(["not a cron", "60 * * * *", "0 0 31 2 *"])("retains the explicit 24-hour compatibility fallback for %s", (cron) => {
    const from = new Date("2026-10-18T19:44:22.832Z");
    expect(computeNextCronRun(cron, from).toISOString()).toBe("2026-10-19T19:44:22.832Z");
  });

  it.each(["23 */6/2 * * *", "0 1-3/2/9 * * *"])("rejects malformed extra slash segments in %s through the canonical evaluator", (cron) => {
    const from = new Date("2026-10-18T19:44:22.832Z");
    expect(parseCronSchedule(cron)).toBeNull();
    expect(computeNextCronFire(cron, from)).toBeNull();
    expect(computeNextCronRun(cron, from).toISOString()).toBe("2026-10-19T19:44:22.832Z");
  });

  it.each(["0 */0x2 * * *", "0 */+2 * * *", "0 */2e0 * * *", "0 */2.0 * * *"])("rejects nondecimal step spelling in %s", (cron) => {
    const from = new Date("2026-10-19T01:00:00.000Z");
    expect(parseCronSchedule(cron)).toBeNull();
    expect(computeNextCronFire(cron, from)).toBeNull();
    expect(computeNextCronRun(cron, from).toISOString()).toBe("2026-10-20T01:00:00.000Z");
  });

  it.each([
    ["0 */02 * * *", "2026-10-19T02:00:00.000Z"],
    ["0 1-3/02 * * *", "2026-10-19T03:00:00.000Z"],
  ])("preserves decimal step digits and leading zeros in %s", (cron, expected) => {
    const from = new Date("2026-10-19T01:00:00.000Z");
    expect(parseCronSchedule(cron)).not.toBeNull();
    expect(computeNextCronFire(cron, from)?.toISOString()).toBe(expected);
    expect(computeNextCronRun(cron, from).toISOString()).toBe(expected);
  });
});

// Every cron fixture and calendar assertion uses UTC so the same behavior is
// required on hosts with different local timezones.

describe("computeNextCronRun — day-of-month (the BI-D72CC945 regression)", () => {
  it("Monthly `0 9 1 * *` from mid-month lands on the 1st of NEXT month, not tomorrow", () => {
    const from = new Date("2026-06-20T10:00:00.000Z"); // Sat Jun 20 2026, 10:00
    const next = computeNextCronRun("0 9 1 * *", from);
    expect(next.getUTCFullYear()).toBe(2026);
    expect(next.getUTCMonth()).toBe(6); // July
    expect(next.getUTCDate()).toBe(1);
    expect(next.getUTCHours()).toBe(9);
    expect(next.getUTCMinutes()).toBe(0);
    expect(next.getUTCSeconds()).toBe(0);
    // The pre-fix bug returned Jun 21 (tomorrow) — guard against regressing.
    expect(next.getUTCMonth() === 5 && next.getUTCDate() === 21).toBe(false);
  });

  it("Monthly fires the same day when the 1st's time is still ahead", () => {
    const from = new Date("2026-06-01T08:00:00.000Z"); // Jun 1, 08:00 (before 09:00)
    const next = computeNextCronRun("0 9 1 * *", from);
    expect(next.getUTCMonth()).toBe(5); // June
    expect(next.getUTCDate()).toBe(1);
    expect(next.getUTCHours()).toBe(9);
  });

  it("Monthly rolls to next month once the 1st's time has passed", () => {
    const from = new Date("2026-06-01T10:00:00.000Z"); // Jun 1, 10:00 (after 09:00)
    const next = computeNextCronRun("0 9 1 * *", from);
    expect(next.getUTCMonth()).toBe(6); // July
    expect(next.getUTCDate()).toBe(1);
  });

  it("honors year rollover (Dec -> Jan)", () => {
    const from = new Date("2026-12-15T12:00:00.000Z"); // Dec 15 2026
    const next = computeNextCronRun("0 9 1 * *", from);
    expect(next.getUTCFullYear()).toBe(2027);
    expect(next.getUTCMonth()).toBe(0); // January
    expect(next.getUTCDate()).toBe(1);
  });
});

describe("computeNextCronRun — daily / weekly / weekday", () => {
  it("daily `0 9 * * *` advances to tomorrow once today's time passed", () => {
    const from = new Date("2026-06-20T10:00:00.000Z");
    const next = computeNextCronRun("0 9 * * *", from);
    expect(next.getUTCDate()).toBe(21);
    expect(next.getUTCHours()).toBe(9);
  });

  it("daily fires today when the time is still ahead", () => {
    const from = new Date("2026-06-20T08:00:00.000Z");
    const next = computeNextCronRun("0 9 * * *", from);
    expect(next.getUTCDate()).toBe(20);
    expect(next.getUTCHours()).toBe(9);
  });

  it("weekly `0 9 * * 0` lands on a Sunday in the future", () => {
    const from = new Date("2026-06-20T10:00:00.000Z");
    const next = computeNextCronRun("0 9 * * 0", from);
    expect(next.getUTCDay()).toBe(0); // Sunday
    expect(next.getUTCHours()).toBe(9);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it("weekdays `30 8 * * 1-5` lands on a Mon–Fri at 08:30", () => {
    const from = new Date("2026-06-20T10:00:00.000Z"); // Saturday
    const next = computeNextCronRun("30 8 * * 1-5", from);
    expect(next.getUTCDay()).toBeGreaterThanOrEqual(1);
    expect(next.getUTCDay()).toBeLessThanOrEqual(5);
    expect(next.getUTCHours()).toBe(8);
    expect(next.getUTCMinutes()).toBe(30);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it("treats day-of-week 7 as Sunday", () => {
    const from = new Date("2026-06-20T10:00:00.000Z");
    const next = computeNextCronRun("0 9 * * 7", from);
    expect(next.getUTCDay()).toBe(0);
  });
});

describe("computeNextCronRun — specific month (Once preset) & union rule", () => {
  it("`0 9 5 7 *` (Jul 5) lands on the next July 5", () => {
    const from = new Date("2026-06-20T10:00:00.000Z"); // before Jul 5
    const next = computeNextCronRun("0 9 5 7 *", from);
    expect(next.getUTCMonth()).toBe(6); // July
    expect(next.getUTCDate()).toBe(5);
    expect(next.getUTCFullYear()).toBe(2026);
  });

  it("`0 9 5 7 *` rolls to next year once the date has passed", () => {
    const from = new Date("2026-08-01T10:00:00.000Z"); // Aug 1, after Jul 5
    const next = computeNextCronRun("0 9 5 7 *", from);
    expect(next.getUTCFullYear()).toBe(2027);
    expect(next.getUTCMonth()).toBe(6);
    expect(next.getUTCDate()).toBe(5);
  });

  it("applies the cron union rule when BOTH day-of-month and day-of-week are set", () => {
    const from = new Date("2026-06-01T00:00:00.000Z");
    const next = computeNextCronRun("0 9 13 * 5", from); // 13th OR Friday
    expect(next.getUTCDate() === 13 || next.getUTCDay() === 5).toBe(true);
  });
});

describe("computeNextCronRun — malformed input", () => {
  it("falls back to ~24h ahead for a non-5-field expression", () => {
    const from = new Date("2026-06-20T10:00:00.000Z");
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

describe("computeNextCronFire (job engine, UTC, full grammar)", () => {
  const at = (iso: string) => new Date(iso);
  const next = (expr: string, from: string) => computeNextCronFire(expr, at(from))?.toISOString();

  it("fires every minute on `* * * * *`, strictly after `from`", () => {
    expect(next("* * * * *", "2026-10-01T10:00:00.000Z")).toBe("2026-10-01T10:01:00.000Z");
    expect(next("* * * * *", "2026-10-01T10:00:30.000Z")).toBe("2026-10-01T10:01:00.000Z");
  });

  it("supports steps, lists and ranges", () => {
    expect(next("*/5 * * * *", "2026-10-01T10:03:00.000Z")).toBe("2026-10-01T10:05:00.000Z");
    expect(next("*/15 * * * *", "2026-10-01T10:45:00.000Z")).toBe("2026-10-01T11:00:00.000Z");
    expect(next("3,18,33,48 * * * *", "2026-10-01T10:19:00.000Z")).toBe("2026-10-01T10:33:00.000Z");
    expect(next("37 */6 * * *", "2026-10-01T07:00:00.000Z")).toBe("2026-10-01T12:37:00.000Z");
    expect(next("0 9-17 * * *", "2026-10-01T17:00:00.000Z")).toBe("2026-10-02T09:00:00.000Z");
  });

  it("evaluates in UTC and rolls over hours, days and years", () => {
    expect(next("0 3 * * *", "2026-10-01T03:00:00.000Z")).toBe("2026-10-02T03:00:00.000Z");
    expect(next("0 0 1 1 *", "2026-12-31T23:59:00.000Z")).toBe("2027-01-01T00:00:00.000Z");
  });

  it("uses day-of-week, with 7 as Sunday, and ORs restricted day fields", () => {
    // 2026-10-01 is a Thursday.
    expect(next("17 6 * * 1", "2026-10-01T00:00:00.000Z")).toBe("2026-10-05T06:17:00.000Z");
    expect(next("0 3 * * 0", "2026-10-01T00:00:00.000Z")).toBe("2026-10-04T03:00:00.000Z");
    expect(next("0 3 * * 7", "2026-10-01T00:00:00.000Z")).toBe("2026-10-04T03:00:00.000Z");
    expect(next("0 0 15 * 1", "2026-10-01T00:00:00.000Z")).toBe("2026-10-05T00:00:00.000Z");
  });

  it("finds Feb 29 in the next leap year", () => {
    expect(next("0 0 29 2 *", "2026-03-01T00:00:00.000Z")).toBe("2028-02-29T00:00:00.000Z");
  });

  it("returns null for expressions it cannot parse, never a guessed schedule", () => {
    for (const bad of ["daily", "* * * *", "60 * * * *", "*/0 * * * *", "a b c d e", "0 0 31 2 *"]) {
      expect(computeNextCronFire(bad, at("2026-10-01T00:00:00.000Z"))).toBeNull();
    }
    expect(parseCronSchedule("0 0 31 2 *")).not.toBeNull();
  });

  it("parses every cron expression the job functions use", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(__dirname, "../queue/functions");
    const exprs = new Set<string>();
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      for (const m of readFileSync(join(dir, file), "utf8").matchAll(/cron\(\s*["'`]([^"'`]+)["'`]\s*\)|cron:\s*["'`]([^"'`]+)["'`]/g)) {
        // Source may escape the slash (`"*\\/10 …"`); compare the string JavaScript evaluates.
        exprs.add((m[1] ?? m[2])!.replace(/\\\//g, "/"));
      }
    }
    expect(exprs.size).toBeGreaterThan(20);
    for (const expr of exprs) expect([expr, computeNextCronFire(expr, at("2026-10-01T00:00:00.000Z"))]).not.toEqual([expr, null]);
  });
});
