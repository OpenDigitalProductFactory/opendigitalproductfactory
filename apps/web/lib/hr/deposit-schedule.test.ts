import { describe, expect, it } from "vitest";
import {
  depositPeriodFor,
  resolveDepositSchedule,
  type ResolvableDepositSchedule,
} from "./deposit-schedule";

function schedule(over: Partial<ResolvableDepositSchedule> & { id: string }): ResolvableDepositSchedule {
  return {
    cadence: "monthly",
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    ...over,
  };
}

describe("resolveDepositSchedule", () => {
  it("returns the schedule in force on the date", () => {
    const got = resolveDepositSchedule(
      [schedule({ id: "a", cadence: "monthly" })],
      new Date("2026-06-01"),
    );
    expect(got?.id).toBe("a");
  });

  it("returns null rather than assuming monthly when nothing covers the date", () => {
    // Guessing the gentler cadence is how a business that should deposit
    // semiweekly silently deposits monthly and takes a penalty.
    const got = resolveDepositSchedule(
      [schedule({ id: "a", effectiveFrom: new Date("2027-01-01") })],
      new Date("2026-06-01"),
    );
    expect(got).toBeNull();
  });

  it("lets a re-determination supersede the older one", () => {
    const got = resolveDepositSchedule(
      [
        schedule({ id: "old", effectiveFrom: new Date("2026-01-01"), cadence: "monthly" }),
        schedule({ id: "new", effectiveFrom: new Date("2026-06-01"), cadence: "semiweekly" }),
      ],
      new Date("2026-07-01"),
    );
    expect(got?.id).toBe("new");
    expect(got?.cadence).toBe("semiweekly");
  });

  it("treats effectiveTo as exclusive", () => {
    const rows = [
      schedule({
        id: "a",
        effectiveFrom: new Date("2026-01-01"),
        effectiveTo: new Date("2026-07-01"), // clock-bomb-guard: allow resolveDepositSchedule compares only against the date passed in, never the system clock
      }),
    ];
    expect(resolveDepositSchedule(rows, new Date("2026-06-30"))?.id).toBe("a");
    expect(resolveDepositSchedule(rows, new Date("2026-07-01"))).toBeNull();
  });
});

describe("depositPeriodFor", () => {
  it("bounds a monthly period", () => {
    const got = depositPeriodFor("monthly", new Date("2026-03-15T00:00:00Z"));
    expect(got?.start.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(got?.endExclusive.toISOString()).toBe("2026-04-01T00:00:00.000Z");
  });

  it("bounds a quarterly period from the quarter's first month", () => {
    const got = depositPeriodFor("quarterly", new Date("2026-08-20T00:00:00Z"));
    expect(got?.start.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(got?.endExclusive.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("rolls a December monthly period into the next year", () => {
    const got = depositPeriodFor("monthly", new Date("2026-12-31T00:00:00Z"));
    expect(got?.endExclusive.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("bounds an annual period", () => {
    const got = depositPeriodFor("annual", new Date("2026-05-05T00:00:00Z"));
    expect(got?.start.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(got?.endExclusive.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("refuses to invent a semiweekly span", () => {
    // The federal semiweekly rule keys off the DAY OF THE WEEK wages were paid
    // and needs the authority's banking-day and holiday calendar. A fabricated
    // span would produce a confident wrong due date.
    expect(depositPeriodFor("semiweekly", new Date("2026-03-15T00:00:00Z"))).toBeNull();
  });
});
