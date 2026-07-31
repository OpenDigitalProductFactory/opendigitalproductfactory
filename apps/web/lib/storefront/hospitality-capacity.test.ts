import { describe, expect, it } from "vitest";

import {
  HOSPITALITY_ALLOCATION_LIFECYCLES,
  HOSPITALITY_CAPACITY_POOL_KINDS,
  HOSPITALITY_CAPACITY_UNITS,
  HOSPITALITY_DEMAND_TYPES,
  HOSPITALITY_RESOURCE_KINDS,
  HospitalityCapacityConflictError,
  HospitalityCapacityVersionError,
  evaluatePoolCapacity,
  isHospitalityResourceAvailableForInterval,
  transitionHospitalityAllocation,
  validateAllocationRequest,
  type HospitalityAllocationFact,
} from "./hospitality-capacity";

const START = new Date("2026-07-30T18:00:00.000Z");
const END = new Date("2026-07-30T19:00:00.000Z");

function allocation(
  over: Partial<HospitalityAllocationFact> = {},
): HospitalityAllocationFact {
  return {
    id: "allocation-1",
    startsAt: START,
    endsAt: END,
    quantity: 4,
    lifecycle: "reserved",
    version: 1,
    ...over,
  };
}

describe("hospitality capacity contract", () => {
  it("keeps the closed vocabularies explicit and archetype-legible", () => {
    expect(HOSPITALITY_RESOURCE_KINDS).toEqual([
      "table",
      "kitchen-station",
      "oven",
      "delivery-vehicle",
      "service-area",
    ]);
    expect(HOSPITALITY_CAPACITY_POOL_KINDS).toEqual([
      "kitchen",
      "bake",
      "delivery-window",
      "event-service",
    ]);
    expect(HOSPITALITY_CAPACITY_UNITS).toContain("seats");
    expect(HOSPITALITY_CAPACITY_UNITS).toContain("batches");
    expect(HOSPITALITY_ALLOCATION_LIFECYCLES).toEqual([
      "reserved",
      "active",
      "released",
      "cancelled",
      "quarantined",
    ]);
    expect(HOSPITALITY_DEMAND_TYPES).toContain("production-order");
  });

  it("rejects malformed allocation requests before a transaction starts", () => {
    expect(() =>
      validateAllocationRequest({
        startsAt: END,
        endsAt: START,
        quantity: 1,
        resourceId: "table-1",
        poolId: null,
      }),
    ).toThrow(/end.*after start/i);
    expect(() =>
      validateAllocationRequest({
        startsAt: START,
        endsAt: END,
        quantity: 0,
        resourceId: "table-1",
        poolId: null,
      }),
    ).toThrow(/quantity/i);
    expect(() =>
      validateAllocationRequest({
        startsAt: START,
        endsAt: END,
        quantity: 1,
        resourceId: "table-1",
        poolId: "kitchen-1",
      }),
    ).toThrow(/exactly one/i);
  });

  it("counts only overlapping live allocations against an aggregate pool", () => {
    const result = evaluatePoolCapacity({
      capacity: 12,
      startsAt: START,
      endsAt: END,
      requestedQuantity: 5,
      allocations: [
        allocation({ id: "live", quantity: 6 }),
        allocation({
          id: "released",
          quantity: 100,
          lifecycle: "released",
        }),
        allocation({
          id: "later",
          quantity: 100,
          startsAt: new Date("2026-07-30T20:00:00.000Z"),
          endsAt: new Date("2026-07-30T21:00:00.000Z"),
        }),
      ],
    });

    expect(result).toEqual({
      used: 6,
      available: 6,
      requested: 5,
      accepted: true,
    });
  });

  it("returns a typed conflict when aggregate demand exceeds supply", () => {
    expect(() =>
      evaluatePoolCapacity({
        capacity: 10,
        startsAt: START,
        endsAt: END,
        requestedQuantity: 5,
        allocations: [allocation({ quantity: 7 })],
        throwOnConflict: true,
      }),
    ).toThrow(HospitalityCapacityConflictError);
  });

  it("enforces expected-version lifecycle transitions and preserves history", () => {
    expect(
      transitionHospitalityAllocation(allocation(), {
        expectedVersion: 1,
        lifecycle: "active",
        at: new Date("2026-07-30T18:05:00.000Z"),
      }),
    ).toMatchObject({ lifecycle: "active", version: 2, releasedAt: null });

    expect(() =>
      transitionHospitalityAllocation(allocation(), {
        expectedVersion: 2,
        lifecycle: "active",
        at: START,
      }),
    ).toThrow(HospitalityCapacityVersionError);

    const released = transitionHospitalityAllocation(
      allocation({ lifecycle: "active" }),
      {
        expectedVersion: 1,
        lifecycle: "released",
        at: END,
        reason: "party departed",
      },
    );
    expect(released).toMatchObject({
      lifecycle: "released",
      version: 2,
      releasedAt: END,
      releaseReason: "party departed",
    });
    expect(() =>
      transitionHospitalityAllocation(released, {
        expectedVersion: 2,
        lifecycle: "active",
        at: END,
      }),
    ).toThrow(/terminal/i);
  });

  it("evaluates recurring availability and dated blocks in the storefront timezone", () => {
    const availability = [
      {
        kind: "available" as const,
        days: [3],
        startTime: "17:00",
        endTime: "22:00",
        date: null,
      },
      {
        kind: "blocked" as const,
        days: [],
        startTime: "18:00",
        endTime: "20:00",
        date: new Date("2026-07-22T00:00:00.000Z"),
      },
    ];

    expect(
      isHospitalityResourceAvailableForInterval({
        availability,
        startsAt: new Date("2026-07-22T17:00:00.000Z"),
        endsAt: new Date("2026-07-22T17:30:00.000Z"),
        timeZone: "UTC",
      }),
    ).toBe(true);
    expect(
      isHospitalityResourceAvailableForInterval({
        availability,
        startsAt: new Date("2026-07-22T18:30:00.000Z"),
        endsAt: new Date("2026-07-22T19:30:00.000Z"),
        timeZone: "UTC",
      }),
    ).toBe(false);
  });
});
