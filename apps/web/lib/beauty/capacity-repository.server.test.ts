import { describe, expect, it, vi } from "vitest";
import type { ResourceCapacityProfile } from "@dpf/storefront-templates";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import { expandBeautyAvailability } from "./availability";
import { loadBeautyCapacityFacts } from "./capacity-repository.server";

const input = {
  profile: {
    archetypeId: "hair-salon",
    category: "beauty-personal-care",
    enabled: true,
    patterns: ["appointment"],
    authorities: ["provider-calendar", "beauty", "staffing"],
    resourceNoun: { singular: "chair", plural: "chairs" },
    physical: true,
    forwardHorizon: false,
    supportsBuffers: true,
    supportsTravel: false,
  } satisfies ResourceCapacityProfile,
  organizationId: "org-1",
  window: { startAt: "2026-08-01T13:00:00.000Z", endAt: "2026-08-02T02:00:00.000Z" },
};

function database() {
  return {
    storefrontConfig: { findFirst: vi.fn(async () => ({ id: "storefront-1", timezone: "America/Chicago" })) },
    beautyResource: { findMany: vi.fn(async () => [{
      id: "chair-1",
      organizationId: "org-1",
      kind: "chair",
      label: "Chair 1",
      status: "active",
      capacity: 1,
      capacityUnit: "appointments",
      serviceArea: "main",
      blockedReason: null,
      version: 4,
      services: [{ itemId: "color" }],
      availability: [{
        availabilityId: "hours-1",
        resourceId: "chair-1",
        kind: "available",
        days: [6],
        startTime: "09:00",
        endTime: "17:00",
        date: null,
        startsAt: null,
        endsAt: null,
        reason: null,
      }],
      allocations: [],
    }]) },
    storefrontBooking: { findMany: vi.fn(async () => [{
      id: "booking-1",
      bookingRef: "BK-1",
      itemId: "color",
      providerId: "provider-1",
      customerName: "Jo",
      scheduledAt: new Date("2026-08-01T15:00:00.000Z"),
      durationMinutes: 90,
      status: "confirmed",
      covers: null,
      demandKind: "appointment",
      provider: { name: "Maya" },
    }]) },
    storefrontItem: { findMany: vi.fn(async () => [{
      id: "color",
      bookingConfig: { beforeBufferMinutes: 10, afterBufferMinutes: 15 },
    }]) },
  };
}

describe("beauty capacity repository", () => {
  it("expands recurring wall-clock availability across DST-safe UTC instants", () => {
    const result = expandBeautyAvailability({
      rows: [{
        availabilityId: "hours-1",
        resourceId: "chair-1",
        kind: "available",
        days: [6],
        startTime: "09:00",
        endTime: "17:00",
        date: null,
        startsAt: null,
        endsAt: null,
        reason: null,
      }],
      windowStart: new Date("2026-08-01T00:00:00.000Z"),
      windowEnd: new Date("2026-08-02T23:59:59.000Z"),
      timeZone: "America/Chicago",
    });

    expect(result).toContainEqual(expect.objectContaining({
      startsAt: new Date("2026-08-01T14:00:00.000Z"),
      endsAt: new Date("2026-08-01T22:00:00.000Z"),
    }));
  });

  it("loads one bounded read and resolves service buffers without N+1 lookups", async () => {
    const db = database();
    const result = await loadBeautyCapacityFacts(db, input);

    expect(result.resources[0]).toMatchObject({
      id: "chair-1",
      serviceItemIds: ["color"],
    });
    expect(result.bookings[0]).toMatchObject({
      bookingRef: "BK-1",
      providerName: "Maya",
      preparationMinutes: 10,
      cleanupMinutes: 15,
    });
    expect(result.availability).toHaveLength(1);
    expect(db.beautyResource.findMany).toHaveBeenCalledTimes(1);
    expect(db.storefrontBooking.findMany).toHaveBeenCalledTimes(1);
    expect(db.storefrontItem.findMany).toHaveBeenCalledTimes(1);
  });

  it("refuses missing storefront ownership", async () => {
    const db = database();
    db.storefrontConfig.findFirst.mockResolvedValue(null as never);
    await expect(loadBeautyCapacityFacts(db, input)).rejects.toThrow(/storefront is unavailable/i);
    expect(db.beautyResource.findMany).not.toHaveBeenCalled();
  });
});
