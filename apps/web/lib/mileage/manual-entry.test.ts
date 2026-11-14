import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AUTOMATION_PERSONA_EMAIL } from "@/lib/govern/automation-persona-identity";
import {
  recordCompanyMileageRate,
  recordManualDrive,
  type ManualEntryDb,
} from "./manual-entry";
import { resolveRateForTrip, type ResolvableRate } from "./rates";

// Nothing under test reads the clock (callers inject `now`); pinned so the
// fixture dates can never drift into meaning something else.
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-14T12:00:00.000Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

const now = new Date("2026-11-14T12:00:00.000Z");
const owner = { userId: "user-1", email: "owner@example.com" };
const automation = { userId: "user-auto", email: AUTOMATION_PERSONA_EMAIL };

function memoryDb() {
  const plans: Array<Record<string, unknown>> = [];
  const rates: Array<Record<string, unknown>> = [];
  const trips: Array<Record<string, unknown>> = [];
  const db: ManualEntryDb = {
    organization: { findFirst: vi.fn(async () => ({ id: "org-1" })) as never },
    mileageRatePlan: {
      findFirst: vi.fn(async () => plans.find((p) => p.isOrgOverride === true && p.lifecycle === "active") ?? null) as never,
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `plan-${plans.length + 1}`, lifecycle: "active", ...data };
        plans.push(row);
        return row;
      }) as never,
    },
    mileageRate: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rates.find((r) => r.planId === where.planId && r.purposeKind === where.purposeKind
          && (r.effectiveFrom as Date).getTime() === (where.effectiveFrom as Date).getTime()) ?? null) as never,
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `rate-${rates.length + 1}`, ...data };
        rates.push(row);
        return row;
      }) as never,
    },
    trip: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        trips.push(data);
        return { tripId: data.tripId as string };
      }) as never,
    },
    $transaction: async (fn) => fn(db),
  };
  return { db, plans, rates, trips };
}

const validRate = {
  amountPerMile: 0.7,
  effectiveFrom: "2026-01-01",
  sourceUrl: "https://www.irs.gov/tax-professionals/standard-mileage-rates",
};

describe("recordCompanyMileageRate", () => {
  it("creates the company plan on first use and a rate that prices a drive on its date", async () => {
    const { db, plans, rates } = memoryDb();

    const result = await recordCompanyMileageRate(db, { ...validRate, actor: owner, now }, "seed1");

    expect(result.ok).toBe(true);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ organizationId: "org-1", isOrgOverride: true, jurisdictionRefId: null });
    expect(rates[0]).toMatchObject({
      purposeKind: "business", sourceUrl: validRate.sourceUrl,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null,
    });

    // The point of the rate: a manual drive (no country signal, employee country
    // unknown) must still find it, which only an unscoped plan guarantees.
    const resolvable: ResolvableRate[] = rates.map((r) => ({
      id: r.id as string, purposeKind: "business", amountPerMile: Number(r.amountPerMile),
      currency: "USD", effectiveFrom: r.effectiveFrom as Date, effectiveTo: null,
      isOrgOverride: true, jurisdictionCountryCode: null,
    }));
    expect(resolveRateForTrip(resolvable, new Date("2026-03-03T00:00:00.000Z"))?.amountPerMile).toBe(0.7);
  });

  it("reuses the existing company plan for a later rate", async () => {
    const { db, plans, rates } = memoryDb();
    await recordCompanyMileageRate(db, { ...validRate, actor: owner, now }, "a");
    await recordCompanyMileageRate(db, { ...validRate, effectiveFrom: "2027-01-01", amountPerMile: 0.72, actor: owner, now }, "b");

    expect(plans).toHaveLength(1);
    expect(rates).toHaveLength(2);
  });

  it("refuses the automation persona — the figure must be a person's", async () => {
    const { db, rates } = memoryDb();
    const result = await recordCompanyMileageRate(db, { ...validRate, actor: automation, now }, "x");
    expect(result.ok).toBe(false);
    expect(rates).toHaveLength(0);
  });

  it.each([
    ["no source", { sourceUrl: "" }],
    ["a non-web source", { sourceUrl: "irs.gov somewhere" }],
    ["a zero rate", { amountPerMile: 0 }],
    ["an implausible rate", { amountPerMile: 70 }],
    ["an unreadable date", { effectiveFrom: "January" }],
  ])("refuses %s", async (_label, over) => {
    const { db, rates } = memoryDb();
    const result = await recordCompanyMileageRate(db, { ...validRate, ...over, actor: owner, now }, "x");
    expect(result.ok).toBe(false);
    expect(rates).toHaveLength(0);
  });

  it("refuses a second rate from the same date instead of failing on the unique key", async () => {
    const { db, rates } = memoryDb();
    await recordCompanyMileageRate(db, { ...validRate, actor: owner, now }, "a");
    const again = await recordCompanyMileageRate(db, { ...validRate, amountPerMile: 0.71, actor: owner, now }, "b");
    expect(again.ok).toBe(false);
    expect(rates).toHaveLength(1);
  });
});

describe("recordManualDrive", () => {
  const drive = {
    employeeProfileId: "emp-1", date: "2026-03-03", fromLabel: "Office", toLabel: "Client site",
    miles: 12.5, purpose: "Site visit for the Q1 install",
  };

  it("records a business drive with no coordinates and the miles the driver read", async () => {
    const { db, trips } = memoryDb();

    const result = await recordManualDrive(db, drive, now, "seed1");

    expect(result.ok).toBe(true);
    expect(trips[0]).toMatchObject({
      employeeProfileId: "emp-1", organizationId: "org-1", captureKind: "manual",
      classification: "business", classifiedByKind: "driver", classifiedAt: now,
      startPlaceLabel: "Office", endPlaceLabel: "Client site", notes: "Site visit for the Q1 install",
      startLatitude: null, startLongitude: null, endLatitude: null, endLongitude: null,
      distanceMeters: 20117,
    });
  });

  it("dates the drive at UTC noon so no time zone can move it to the previous day", async () => {
    const { db, trips } = memoryDb();
    await recordManualDrive(db, drive, now, "seed1");
    expect((trips[0]!.startedAt as Date).toISOString().slice(0, 10)).toBe("2026-03-03");
    expect((trips[0]!.endedAt as Date).getTime()).toBeGreaterThan((trips[0]!.startedAt as Date).getTime());
  });

  it.each([
    ["zero miles", { miles: 0 }],
    ["no purpose", { purpose: "  " }],
    ["no destination", { toLabel: "" }],
    ["a future date", { date: "2026-12-25" }],
    ["an unreadable date", { date: "last Tuesday" }],
  ])("refuses %s", async (_label, over) => {
    const { db, trips } = memoryDb();
    const result = await recordManualDrive(db, { ...drive, ...over }, now, "x");
    expect(result.ok).toBe(false);
    expect(trips).toHaveLength(0);
  });
});
