import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storefrontFindMany: vi.fn(),
  profileFindFirst: vi.fn(),
  resourceFindMany: vi.fn(),
  turnFindMany: vi.fn(),
  allocationFindMany: vi.fn(),
  bookingFindMany: vi.fn(),
  rollupUpsert: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    storefrontConfig: { findMany: mocks.storefrontFindMany },
    businessProfile: { findFirst: mocks.profileFindFirst },
    hospitalityResource: { findMany: mocks.resourceFindMany },
    hospitalityServiceTurn: { findMany: mocks.turnFindMany },
    hospitalityCapacityAllocation: { findMany: mocks.allocationFindMany },
    storefrontBooking: { findMany: mocks.bookingFindMany },
    businessMetricRollup: { upsert: mocks.rollupUpsert },
  },
}));

import { defaultBusinessMetricRollupDeps } from "./business-metric-rollup.server";

describe("defaultBusinessMetricRollupDeps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storefrontFindMany.mockResolvedValue([
      { id: "sf-1", organizationId: "org-1", timezone: "America/Chicago" },
    ]);
    mocks.profileFindFirst.mockResolvedValue({
      businessHours: { friday: { open: "17:00", close: "23:00" } },
      hoursConfirmedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    mocks.resourceFindMany.mockResolvedValue([]);
    mocks.turnFindMany.mockResolvedValue([]);
    mocks.allocationFindMany.mockResolvedValue([]);
    mocks.bookingFindMany.mockResolvedValue([]);
    mocks.rollupUpsert.mockResolvedValue({});
  });

  it("discovers only restaurant contexts and scopes every source query to the tenant", async () => {
    const deps = defaultBusinessMetricRollupDeps();
    const [context] = await deps.listRestaurantContexts();
    const window = {
      periodKey: "2026-07-31",
      start: new Date("2026-07-31T05:00:00.000Z"),
      end: new Date("2026-08-01T05:00:00.000Z"),
      timezone: "America/Chicago",
    };
    await deps.loadRestaurantSource(context!, window, window.end);

    expect(mocks.storefrontFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { archetype: { archetypeId: { in: ["restaurant"] } } },
    }));
    for (const sourceMock of [
      mocks.resourceFindMany,
      mocks.turnFindMany,
      mocks.allocationFindMany,
      mocks.bookingFindMany,
    ]) {
      expect(sourceMock).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-1", storefrontId: "sf-1" }),
      }));
    }
  });

  it("upserts by the complete reproducible projection identity", async () => {
    const deps = defaultBusinessMetricRollupDeps();
    const computedAt = new Date("2026-08-01T02:00:00.000Z");
    await deps.upsert({
      organizationId: "org-1",
      metricKey: "covers",
      periodStart: new Date("2026-07-31T05:00:00.000Z"),
      periodEnd: new Date("2026-08-01T05:00:00.000Z"),
      timezone: "America/Chicago",
      dimensionsHash: "hash",
      dimensions: { storefrontId: "sf-1" },
      value: 42,
      unit: "count",
      availability: "available",
      unavailableReason: null,
      definitionVersion: "restaurant-v1",
      sourceWatermark: computedAt,
      sourceLineage: { sourceModels: ["HospitalityServiceTurn"], sourceRows: 10, storefrontId: "sf-1" },
    }, computedAt);

    expect(mocks.rollupUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId_metricKey_periodStart_periodEnd_dimensionsHash_definitionVersion:
          expect.objectContaining({
            organizationId: "org-1",
            metricKey: "covers",
            dimensionsHash: "hash",
            definitionVersion: "restaurant-v1",
          }),
      },
      update: expect.objectContaining({ value: 42, computedAt }),
    }));
  });
});
