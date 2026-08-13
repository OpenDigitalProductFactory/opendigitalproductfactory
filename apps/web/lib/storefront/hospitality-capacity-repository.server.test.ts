import { describe, expect, it, vi } from "vitest";

import {
  allocateHospitalityCapacity,
  releaseHospitalityCapacity,
  resolveHospitalityResourceForProvider,
  transitionHospitalityCapacity,
} from "./hospitality-capacity-repository.server";
import {
  HospitalityCapacityConflictError,
  HospitalityCapacityVersionError,
} from "./hospitality-capacity";

function database(overrides: Record<string, unknown> = {}) {
  return {
    businessProfile: {
      findFirst: vi.fn(async () => ({ timezone: "UTC" })),
    },
    hospitalityResource: {
      findFirst: vi.fn(async () => ({
        id: "table-1",
        legacyServiceProviderId: "provider-1",
        status: "active",
      })),
    },
    hospitalityCapacityPool: {
      findFirst: vi.fn(async () => ({
        id: "kitchen-1",
        capacity: 12,
        status: "active",
      })),
    },
    hospitalityCapacityAllocation: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "allocation-row",
        version: 1,
        ...data,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    $queryRaw: vi.fn(async () => [{ id: "kitchen-1" }]),
    ...overrides,
  };
}

const interval = {
  startsAt: new Date("2026-07-30T18:00:00.000Z"),
  endsAt: new Date("2026-07-30T19:00:00.000Z"),
};

describe("hospitality capacity repository", () => {
  it("resolves only an active same-storefront resource through the explicit legacy link", async () => {
    const db = database();
    await expect(
      resolveHospitalityResourceForProvider(db, {
        organizationId: "org-1",
        storefrontId: "storefront-1",
        providerId: "provider-1",
      }),
    ).resolves.toEqual({
      id: "table-1",
      legacyServiceProviderId: "provider-1",
      status: "active",
    });
    expect(db.hospitalityResource.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        storefrontId: "storefront-1",
        legacyServiceProviderId: "provider-1",
        status: "active",
      },
      select: { id: true, legacyServiceProviderId: true, status: true },
    });
  });

  it("creates a discrete allocation with a stable idempotency boundary", async () => {
    const db = database();
    await allocateHospitalityCapacity(db, {
      organizationId: "org-1",
      storefrontId: "storefront-1",
      resourceId: "table-1",
      poolId: null,
      demandType: "booking",
      demandRef: "BK-1",
      bookingId: "booking-1",
      bookingHoldId: null,
      quantity: 1,
      idempotencyKey: "booking:booking-1",
      ...interval,
    });

    expect(db.hospitalityCapacityAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        resourceId: "table-1",
        poolId: null,
        demandType: "booking",
        demandRef: "BK-1",
        idempotencyKey: "booking:booking-1",
        lifecycle: "reserved",
      }),
    });
    expect(
      db.hospitalityCapacityAllocation.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        resourceId: "table-1",
        demandType: "hold",
        lifecycle: { in: ["reserved", "active"] },
        bookingHold: { expiresAt: { lte: expect.any(Date) } },
      },
      data: {
        lifecycle: "released",
        releasedAt: expect.any(Date),
        releaseReason: "Hold expired",
        version: { increment: 1 },
      },
    });
  });

  it("rejects a discrete allocation outside the resource schedule", async () => {
    const create = vi.fn();
    const db = database({
      hospitalityResource: {
        findFirst: vi.fn(async () => ({
          id: "table-1",
          legacyServiceProviderId: "provider-1",
          status: "active",
          availability: [
            {
              kind: "available",
              days: [4],
              startTime: "09:00",
              endTime: "17:00",
              date: null,
            },
          ],
          storefront: { timezone: "UTC" },
        })),
      },
      hospitalityCapacityAllocation: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create,
        updateMany: vi.fn(),
      },
    });

    await expect(
      allocateHospitalityCapacity(db, {
        organizationId: "org-1",
        storefrontId: "storefront-1",
        resourceId: "table-1",
        poolId: null,
        demandType: "booking",
        demandRef: "BK-1",
        bookingId: "booking-1",
        bookingHoldId: null,
        startsAt: new Date("2026-07-30T18:00:00.000Z"),
        endsAt: new Date("2026-07-30T19:00:00.000Z"),
        quantity: 1,
        idempotencyKey: "booking:booking-1",
      }),
    ).rejects.toBeInstanceOf(HospitalityCapacityConflictError);
    expect(create).not.toHaveBeenCalled();
  });

  it("allows an authenticated service turn to extend beyond the last public bookable start", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "allocation-row",
      version: 1,
      ...data,
    }));
    const db = database({
      businessProfile: {
        findFirst: vi.fn(async () => ({ timezone: "America/Chicago" })),
      },
      hospitalityResource: {
        findFirst: vi.fn(async () => ({
          id: "table-1",
          legacyServiceProviderId: "provider-1",
          status: "active",
          capacity: 4,
          availability: [{
            kind: "available",
            days: [3],
            startTime: "11:00",
            endTime: "22:00",
            date: null,
          }],
        })),
      },
      hospitalityCapacityAllocation: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create,
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    });

    await expect(
      allocateHospitalityCapacity(db, {
        organizationId: "org-1",
        storefrontId: "storefront-1",
        resourceId: "table-1",
        poolId: null,
        demandType: "booking",
        demandRef: "BK-WALK-IN",
        bookingId: "booking-walk-in",
        bookingHoldId: null,
        serviceTurnId: "turn-1",
        startsAt: new Date("2026-08-13T02:17:00.000Z"),
        // clock-bomb-guard: allow pure historical interval fixture has no wall-clock dependency
        endsAt: new Date("2026-08-13T03:47:00.000Z"),
        quantity: 1,
        idempotencyKey: "seat:booking-walk-in:table-1",
        enforceResourceAvailability: false,
      }),
    ).resolves.toEqual(expect.objectContaining({ demandRef: "BK-WALK-IN" }));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("evaluates a Restaurant table schedule in the operator's Chicago timezone", async () => {
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "allocation-row",
      version: 1,
      ...data,
    }));
    const db = database({
      businessProfile: {
        findFirst: vi.fn(async () => ({ timezone: "America/Chicago" })),
      },
      hospitalityResource: {
        findFirst: vi.fn(async () => ({
          id: "table-1",
          legacyServiceProviderId: "provider-1",
          status: "active",
          capacity: 4,
          availability: [
            {
              kind: "available",
              days: [3],
              startTime: "11:00",
              endTime: "22:00",
              date: null,
            },
          ],
          storefront: { timezone: "Europe/London" },
        })),
      },
      hospitalityCapacityAllocation: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create,
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    });

    await expect(
      allocateHospitalityCapacity(db, {
        organizationId: "org-1",
        storefrontId: "storefront-1",
        resourceId: "table-1",
        poolId: null,
        demandType: "booking",
        demandRef: "BK-CHICAGO",
        bookingId: "booking-chicago",
        bookingHoldId: null,
        startsAt: new Date("2026-08-13T00:31:27.615Z"),
        // clock-bomb-guard: allow pure interval fixture has no wall-clock dependency
        endsAt: new Date("2026-08-13T02:01:27.615Z"),
        quantity: 1,
        idempotencyKey: "booking:booking-chicago",
      }),
    ).resolves.toEqual(expect.objectContaining({ demandRef: "BK-CHICAGO" }));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("rejects party demand above a discrete resource's seat capacity", async () => {
    const create = vi.fn();
    const db = database({
      hospitalityResource: {
        findFirst: vi.fn(async () => ({
          id: "table-1",
          legacyServiceProviderId: "provider-1",
          status: "active",
          capacity: 4,
          availability: [],
          storefront: { timezone: "UTC" },
        })),
      },
      hospitalityCapacityAllocation: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create,
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    });

    await expect(
      allocateHospitalityCapacity(db, {
        organizationId: "org-1",
        storefrontId: "storefront-1",
        resourceId: "table-1",
        poolId: null,
        demandType: "booking",
        demandRef: "BK-1",
        bookingId: "booking-1",
        bookingHoldId: null,
        quantity: 5,
        idempotencyKey: "booking:booking-1",
        ...interval,
      }),
    ).rejects.toBeInstanceOf(HospitalityCapacityConflictError);
    expect(create).not.toHaveBeenCalled();
  });

  it("locks an aggregate pool and rejects demand above overlapping supply", async () => {
    const db = database({
      hospitalityCapacityAllocation: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => [
          {
            id: "existing",
            startsAt: interval.startsAt,
            endsAt: interval.endsAt,
            quantity: 9,
            lifecycle: "active",
            version: 1,
          },
        ]),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
    });

    await expect(
      allocateHospitalityCapacity(db, {
        organizationId: "org-1",
        storefrontId: "storefront-1",
        resourceId: null,
        poolId: "kitchen-1",
        demandType: "event",
        demandRef: "EV-1",
        bookingId: null,
        bookingHoldId: null,
        quantity: 4,
        idempotencyKey: "event:EV-1",
        ...interval,
      }),
    ).rejects.toBeInstanceOf(HospitalityCapacityConflictError);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.hospitalityCapacityAllocation.create).not.toHaveBeenCalled();
  });

  it("releases capacity by versioned update without deleting history", async () => {
    const db = database();
    await expect(
      releaseHospitalityCapacity(db, {
        allocationId: "allocation-row",
        organizationId: "org-1",
        expectedVersion: 3,
        at: new Date("2026-07-30T19:00:00.000Z"),
        reason: "party departed",
      }),
    ).resolves.toBeUndefined();
    expect(db.hospitalityCapacityAllocation.updateMany).toHaveBeenCalledWith({
      where: {
        id: "allocation-row",
        organizationId: "org-1",
        version: 3,
        lifecycle: { in: ["reserved", "active"] },
      },
      data: {
        lifecycle: "released",
        releasedAt: new Date("2026-07-30T19:00:00.000Z"),
        releaseReason: "party departed",
        version: { increment: 1 },
      },
    });
  });

  it("activates and cancels allocations through the same versioned lifecycle boundary", async () => {
    const db = database();
    await transitionHospitalityCapacity(db, {
      allocationId: "allocation-row",
      organizationId: "org-1",
      expectedVersion: 1,
      lifecycle: "active",
      at: new Date("2026-07-30T18:05:00.000Z"),
    });
    expect(db.hospitalityCapacityAllocation.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: "allocation-row",
        organizationId: "org-1",
        version: 1,
        lifecycle: "reserved",
      },
      data: {
        lifecycle: "active",
        releasedAt: null,
        releaseReason: null,
        version: { increment: 1 },
      },
    });

    await transitionHospitalityCapacity(db, {
      allocationId: "allocation-row",
      organizationId: "org-1",
      expectedVersion: 2,
      lifecycle: "cancelled",
      at: new Date("2026-07-30T18:15:00.000Z"),
      reason: "guest cancelled",
    });
    expect(db.hospitalityCapacityAllocation.updateMany).toHaveBeenLastCalledWith({
      where: {
        id: "allocation-row",
        organizationId: "org-1",
        version: 2,
        lifecycle: { in: ["reserved", "active"] },
      },
      data: {
        lifecycle: "cancelled",
        releasedAt: new Date("2026-07-30T18:15:00.000Z"),
        releaseReason: "guest cancelled",
        version: { increment: 1 },
      },
    });
  });

  it("surfaces an expected-version conflict when no row changes", async () => {
    const db = database({
      hospitalityCapacityAllocation: {
        findFirst: vi.fn(async () => null),
        findMany: vi.fn(async () => []),
        create: vi.fn(),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    });
    await expect(
      releaseHospitalityCapacity(db, {
        allocationId: "allocation-row",
        organizationId: "org-1",
        expectedVersion: 3,
        at: interval.endsAt,
        reason: "party departed",
      }),
    ).rejects.toBeInstanceOf(HospitalityCapacityVersionError);
  });
});
