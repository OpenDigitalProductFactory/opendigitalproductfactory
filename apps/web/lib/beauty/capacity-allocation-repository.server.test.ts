import { describe, expect, it, vi } from "vitest";
import {
  allocateBeautyCapacity,
  BeautyCapacityConflictError,
  BeautyCapacityVersionError,
  releaseBeautyCapacity,
  releaseBeautyCapacityByDemand,
} from "./capacity-allocation-repository.server";

vi.mock("@/lib/shared/new-id", () => ({ newId: () => "abc123def456" }));

function database() {
  return {
    beautyResource: {
      findFirst: vi.fn(async () => ({
        id: "chair-1",
        status: "active",
        availability: [],
        storefront: { timezone: "UTC" },
      })),
    },
    beautyCapacityAllocation: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "row-1", version: 1, ...data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
  };
}

const request = {
  organizationId: "org-1",
  storefrontId: "storefront-1",
  resourceId: "chair-1",
  itemId: "color",
  demandRef: "BK-1",
  bookingId: "booking-1",
  bookingHoldId: null,
  startsAt: new Date("2026-08-01T15:00:00.000Z"),
  endsAt: new Date("2026-08-01T16:30:00.000Z"),
  quantity: 1,
  idempotencyKey: "booking:booking-1",
};

describe("beauty capacity allocation repository", () => {
  it("checks same-tenant service eligibility and creates a confirmed allocation", async () => {
    const db = database();
    await allocateBeautyCapacity(db, request);

    expect(db.beautyResource.findFirst).toHaveBeenCalledWith({
      where: {
        id: "chair-1",
        organizationId: "org-1",
        storefrontId: "storefront-1",
        status: "active",
        services: { some: { itemId: "color" } },
      },
      select: {
        id: true,
        status: true,
        availability: {
          select: {
            availabilityId: true,
            resourceId: true,
            kind: true,
            days: true,
            startTime: true,
            endTime: true,
            date: true,
            startsAt: true,
            endsAt: true,
            reason: true,
          },
        },
        storefront: { select: { timezone: true } },
      },
    });
    expect(db.beautyCapacityAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        allocationId: "BA-ABC123DEF456",
        lifecycle: "confirmed",
        bookingId: "booking-1",
        bookingHoldId: null,
      }),
    });
  });

  it("creates held lifecycle for a temporary booking hold", async () => {
    const db = database();
    await allocateBeautyCapacity(db, {
      ...request,
      bookingId: null,
      bookingHoldId: "hold-1",
      demandRef: "HOLD-1",
      idempotencyKey: "hold:hold-1",
    });
    expect(db.beautyCapacityAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ lifecycle: "held", demandType: "hold" }),
    });
  });

  it("rejects a qualified resource outside its physical availability", async () => {
    const db = database();
    db.beautyResource.findFirst.mockResolvedValue({
      id: "chair-1",
      status: "active",
      storefront: { timezone: "UTC" },
      availability: [{
        availabilityId: "hours-1",
        resourceId: "chair-1",
        kind: "available",
        days: [6],
        startTime: "09:00",
        endTime: "12:00",
        date: null,
        startsAt: null,
        endsAt: null,
        reason: null,
      }],
    } as never);
    await expect(allocateBeautyCapacity(db, request)).rejects.toBeInstanceOf(BeautyCapacityConflictError);
    expect(db.beautyCapacityAllocation.create).not.toHaveBeenCalled();
  });

  it("returns an idempotent allocation before another resource check", async () => {
    const db = database();
    db.beautyCapacityAllocation.findFirst.mockResolvedValue({ id: "existing" } as never);
    await expect(allocateBeautyCapacity(db, request)).resolves.toEqual({ id: "existing" });
    expect(db.beautyResource.findFirst).not.toHaveBeenCalled();
    expect(db.beautyCapacityAllocation.create).not.toHaveBeenCalled();
  });

  it("translates the database exclusion guard into an owner-safe conflict", async () => {
    const db = database();
    db.beautyCapacityAllocation.create.mockRejectedValue({
      code: "P2004",
      meta: { database_error: "BeautyCapacityAllocation_no_resource_overlap" },
    });
    await expect(allocateBeautyCapacity(db, request)).rejects.toBeInstanceOf(BeautyCapacityConflictError);
  });

  it("releases by expected version without deleting history", async () => {
    const db = database();
    await releaseBeautyCapacity(db, {
      allocationId: "BA-1",
      organizationId: "org-1",
      expectedVersion: 3,
      at: new Date("2026-08-01T16:30:00.000Z"),
      reason: "Appointment complete",
    });
    expect(db.beautyCapacityAllocation.updateMany).toHaveBeenCalledWith({
      where: {
        allocationId: "BA-1",
        organizationId: "org-1",
        version: 3,
        lifecycle: { in: ["held", "confirmed", "active"] },
      },
      data: expect.objectContaining({ lifecycle: "released", version: { increment: 1 } }),
    });
  });

  it("releases converted holds and clears only the expiring hold link", async () => {
    const db = database();
    await expect(releaseBeautyCapacityByDemand(db, {
      organizationId: "org-1",
      demandRef: "HOLD-1",
      at: new Date("2026-08-01T15:00:00.000Z"),
      reason: "Converted to booking",
      clearBookingHoldLink: true,
    })).resolves.toBe(1);
    expect(db.beautyCapacityAllocation.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        demandRef: "HOLD-1",
        lifecycle: { in: ["held", "confirmed", "active"] },
      },
      data: expect.objectContaining({ lifecycle: "released", bookingHoldId: null }),
    });
  });

  it("fails closed on stale lifecycle version", async () => {
    const db = database();
    db.beautyCapacityAllocation.updateMany.mockResolvedValue({ count: 0 });
    await expect(releaseBeautyCapacity(db, {
      allocationId: "BA-1",
      organizationId: "org-1",
      expectedVersion: 2,
      at: new Date(),
      reason: "Cancelled",
    })).rejects.toBeInstanceOf(BeautyCapacityVersionError);
  });
});
