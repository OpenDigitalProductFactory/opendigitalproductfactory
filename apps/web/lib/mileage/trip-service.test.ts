import { describe, expect, it } from "vitest";
import {
  monetisePeriod,
  recordTrip,
  setTripClassification,
  type RecordTripInput,
  type TripServiceClient,
} from "./trip-service";
import type { ResolvableRate } from "./rates";

function baseInput(over: Partial<RecordTripInput> = {}): RecordTripInput {
  return {
    employeeProfileId: "emp_1",
    startedAt: new Date("2026-08-10T13:00:00.000Z"),
    endedAt: new Date("2026-08-10T13:32:00.000Z"),
    startLatitude: 37.7749,
    startLongitude: -122.4194,
    endLatitude: 37.8044,
    endLongitude: -122.2712,
    distanceMeters: 21400,
    captureKind: "automatic",
    ...over,
  };
}

function fakeDb(over: Partial<Record<string, unknown>> = {}) {
  const created: Array<Record<string, unknown>> = [];
  const updated: Array<Record<string, unknown>> = [];
  const db = {
    driverLocationConsent: {
      findFirst: async () => ({ consentStatus: "granted", revokedAt: null }),
    },
    organization: { findFirst: async () => ({ id: "org_1" }) },
    trip: {
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return { tripId: String(args.data.tripId) };
      },
      findMany: async () => [],
      update: async (args: Record<string, unknown>) => {
        updated.push(args);
        return {};
      },
    },
    ...over,
  } as unknown as TripServiceClient;
  return { db, created, updated };
}

describe("recordTrip — consent gate", () => {
  it("records a drive for a driver with granted consent", async () => {
    const { db, created } = fakeDb();
    const out = await recordTrip(db, baseInput(), "0001");

    expect(out).toEqual({ recorded: true, tripId: "TRIP-0001" });
    expect(created[0]?.employeeProfileId).toBe("emp_1");
    expect(created[0]?.distanceMeters).toBe(21400);
  });

  it("refuses when no consent record exists at all", async () => {
    const { db, created } = fakeDb({
      driverLocationConsent: { findFirst: async () => null },
    });
    const out = await recordTrip(db, baseInput(), "0002");

    // The difference between mileage tracking and surveillance is this branch.
    expect(out).toMatchObject({ recorded: false, refusal: "no_consent" });
    expect(created).toHaveLength(0);
  });

  it("refuses when consent was revoked, even if a row still exists", async () => {
    const { db, created } = fakeDb({
      driverLocationConsent: {
        findFirst: async () => ({ consentStatus: "revoked", revokedAt: new Date() }),
      },
    });
    const out = await recordTrip(db, baseInput(), "0003");

    expect(out).toMatchObject({ recorded: false, refusal: "consent_revoked" });
    expect(created).toHaveLength(0);
  });

  it("refuses a pending consent — unknown is not yes", async () => {
    const { db } = fakeDb({
      driverLocationConsent: {
        findFirst: async () => ({ consentStatus: "pending", revokedAt: null }),
      },
    });
    expect(await recordTrip(db, baseInput(), "0004")).toMatchObject({
      recorded: false,
      refusal: "consent_revoked",
    });
  });

  it("rejects a zero or negative distance before touching consent", async () => {
    const { db, created } = fakeDb();
    expect(await recordTrip(db, baseInput({ distanceMeters: 0 }), "0005")).toMatchObject({
      refusal: "invalid_distance",
    });
    expect(created).toHaveLength(0);
  });

  it("rejects a drive that ends before it starts", async () => {
    const { db } = fakeDb();
    const out = await recordTrip(
      db,
      baseInput({
        startedAt: new Date("2026-08-10T14:00:00.000Z"),
        endedAt: new Date("2026-08-10T13:00:00.000Z"),
      }),
      "0006",
    );
    expect(out).toMatchObject({ refusal: "invalid_interval" });
  });
});

describe("setTripClassification", () => {
  it("records who classified, so a later rule pass cannot overwrite a human", async () => {
    const { db, updated } = fakeDb();
    await setTripClassification(db, "TRIP-0001", "business", "driver", new Date("2026-08-11T00:00:00.000Z"));

    expect(updated[0]).toMatchObject({
      where: { tripId: "TRIP-0001" },
      data: { classification: "business", classifiedByKind: "driver" },
    });
  });
});

describe("monetisePeriod — idempotency", () => {
  const rates: ResolvableRate[] = [
    {
      id: "rate_1",
      purposeKind: "business",
      amountPerMile: 0.725,
      currency: "USD",
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      effectiveTo: null,
      isOrgOverride: false,
    },
  ];

  function tripRow(over: Record<string, unknown> = {}) {
    return {
      id: "t1",
      tripId: "TRIP-0001",
      startedAt: new Date("2026-08-10T13:00:00.000Z"),
      distanceMeters: 16093,
      classification: "business",
      startPlaceLabel: null,
      endPlaceLabel: null,
      customerAccountId: null,
      expenseItemId: null,
      ...over,
    };
  }

  it("prices an unmonetised business trip", async () => {
    const { db } = fakeDb({ trip: { findMany: async () => [tripRow()], create: async () => ({ tripId: "" }), update: async () => ({}) } });
    const out = await monetisePeriod(db, {
      employeeProfileId: "emp_1",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T23:59:59.000Z"),
      rates,
    });

    expect(out.pricing.lines).toHaveLength(1);
    expect(out.pricing.totalAmount).toBeCloseTo(7.25, 2);
    expect(out.alreadyMonetised).toEqual([]);
  });

  it("excludes a trip already on a claim instead of paying it twice", async () => {
    const { db } = fakeDb({
      trip: {
        findMany: async () => [tripRow({ expenseItemId: "item_1" })],
        create: async () => ({ tripId: "" }),
        update: async () => ({}),
      },
    });
    const out = await monetisePeriod(db, {
      employeeProfileId: "emp_1",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T23:59:59.000Z"),
      rates,
    });

    // Re-running a period must be safe and VISIBLY so.
    expect(out.pricing.lines).toHaveLength(0);
    expect(out.alreadyMonetised).toEqual(["TRIP-0001"]);
  });

  it("reports a personal trip as skipped rather than dropping it", async () => {
    const { db } = fakeDb({
      trip: {
        findMany: async () => [tripRow({ classification: "personal" })],
        create: async () => ({ tripId: "" }),
        update: async () => ({}),
      },
    });
    const out = await monetisePeriod(db, {
      employeeProfileId: "emp_1",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-08-31T23:59:59.000Z"),
      rates,
    });

    expect(out.pricing.lines).toHaveLength(0);
    expect(out.pricing.skipped[0]).toMatchObject({ tripId: "TRIP-0001", reason: "not-business" });
  });
});
