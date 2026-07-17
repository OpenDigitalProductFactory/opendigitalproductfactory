import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockCorrelate } = vi.hoisted(() => ({
  mockPrisma: {
    customerSite: {
      findMany: vi.fn(),
    },
    customerConfigurationItem: {
      findMany: vi.fn(),
    },
    inventoryEntity: {
      findMany: vi.fn(),
    },
  },
  // The correlation logic itself is covered by inventory-cci-bridge.test.ts; here it is a
  // controllable stub so the summary test stays focused on the summary's own aggregation.
  mockCorrelate: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma, correlateDiscoveryToEstate: mockCorrelate }));

import { loadCustomerEstateSummary } from "./account-estate-summary";

describe("loadCustomerEstateSummary", () => {
  beforeEach(() => {
    mockPrisma.customerSite.findMany.mockReset();
    mockPrisma.customerConfigurationItem.findMany.mockReset();
    mockPrisma.inventoryEntity.findMany.mockReset();
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([]);
    mockCorrelate.mockReset();
    mockCorrelate.mockReturnValue({ matches: [], managedAndDiscovered: 0, managedNotDiscovered: 0, discoveredNotManaged: 0 });
  });

  it("summarizes site, lifecycle, and recurring-license attention", async () => {
    mockPrisma.customerSite.findMany.mockResolvedValue([
      { id: "site-1", name: "Dallas HQ", status: "active" },
      { id: "site-2", name: "Plano Branch", status: "active" },
    ]);

    mockPrisma.customerConfigurationItem.findMany.mockResolvedValue([
      {
        id: "ci-1",
        customerCiId: "CCI-1",
        name: "SentinelOne Complete",
        ciType: "security_software",
        status: "active",
        siteId: "site-1",
        technologySourceType: "commercial",
        supportModel: "subscription",
        normalizedVersion: null,
        observedVersion: null,
        renewalDate: new Date("2026-06-01T00:00:00.000Z"),
        warrantyEndAt: null,
        endOfSupportAt: null,
        endOfLifeAt: null,
        billingCadence: "annual",
        customerChargeModel: "pass_through",
        licenseQuantity: 75,
        unitCost: 12,
        customerUnitPrice: 18,
      },
      {
        id: "ci-2",
        customerCiId: "CCI-2",
        name: "Ubuntu Server",
        ciType: "server",
        status: "active",
        siteId: "site-1",
        technologySourceType: "open_source",
        supportModel: "lts",
        normalizedVersion: "22.04",
        observedVersion: "22.04.4",
        renewalDate: null,
        warrantyEndAt: null,
        endOfSupportAt: new Date("2026-07-15T00:00:00.000Z"),
        endOfLifeAt: null,
        billingCadence: null,
        customerChargeModel: null,
        licenseQuantity: null,
        unitCost: null,
        customerUnitPrice: null,
      },
    ]);

    const summary = await loadCustomerEstateSummary("acct-1", new Date("2026-04-23T00:00:00.000Z"));

    expect(summary.siteCount).toBe(2);
    expect(summary.activeSiteCount).toBe(2);
    expect(summary.managedItemCount).toBe(2);
    expect(summary.lifecycleAttentionCount).toBe(2);
    expect(summary.recurringLicensedItemCount).toBe(1);
    expect(summary.openSourceCount).toBe(1);
    expect(summary.commercialCount).toBe(1);
    expect(summary.reviewQueueCounts).toEqual({
      urgent: 0,
      renewal: 1,
      review: 1,
      research: 0,
    });
    expect(summary.reviewQueues.renewal[0]).toMatchObject({
      name: "SentinelOne Complete",
      queue: "renewal",
    });
    expect(summary.topAttentionItems).toHaveLength(2);
    expect(summary.topAttentionItems[0]).toMatchObject({
      name: "SentinelOne Complete",
      recommendedAction: "renew",
    });
  });

  it("surfaces the discovery↔managed-CI correlation counts (BI-828998DC)", async () => {
    mockPrisma.customerSite.findMany.mockResolvedValue([]);
    mockPrisma.customerConfigurationItem.findMany.mockResolvedValue([]);
    mockPrisma.inventoryEntity.findMany.mockResolvedValue([
      { id: "e-1", manufacturer: "Dell", productModel: "PowerEdge R750", name: "srv", customerAccountId: "acct-1", customerSiteId: null, properties: {} },
    ]);
    mockCorrelate.mockReturnValue({
      matches: [{ inventoryEntityId: "e-1", configurationItemId: "cci-1", method: "model", confidence: 0.8 }],
      managedAndDiscovered: 1,
      managedNotDiscovered: 3,
      discoveredNotManaged: 2,
    });

    const summary = await loadCustomerEstateSummary("acct-1");

    expect(mockPrisma.inventoryEntity.findMany).toHaveBeenCalled();
    expect(summary.discoveryCorrelation).toEqual({
      managedAndDiscovered: 1,
      managedNotDiscovered: 3,
      discoveredNotManaged: 2,
    });
  });
});
