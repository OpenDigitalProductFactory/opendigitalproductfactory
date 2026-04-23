import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    country: {
      findFirst: vi.fn(),
    },
    region: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    city: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    address: {
      create: vi.fn(),
    },
    customerSite: {
      create: vi.fn(),
    },
    customerSiteNode: {
      create: vi.fn(),
    },
    customerConfigurationItem: {
      create: vi.fn(),
    },
    activity: {
      create: vi.fn(),
    },
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/actions/finance", () => ({
  generateInvoiceFromSalesOrder: vi.fn(),
}));

vi.mock("@/lib/shared/site-address-validation", () => ({
  searchValidatedSiteAddresses: vi.fn(),
  resolveValidatedSiteAddress: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";
import {
  resolveValidatedSiteAddress,
  searchValidatedSiteAddresses,
} from "@/lib/shared/site-address-validation";
import {
  createCustomerConfigurationItem,
  searchCustomerSiteAddresses,
  createCustomerSite,
  createCustomerSiteNode,
} from "./crm";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchCustomerSiteAddresses", () => {
  it("delegates lookup to the validated address search service", async () => {
    vi.mocked(searchValidatedSiteAddresses).mockResolvedValue([
      {
        providerRef: "provider-ref-1",
        label: "123 Main St, Dallas, Texas 75201, United States",
        addressLine1: "123 Main St",
        addressLine2: null,
        city: "Dallas",
        region: "Texas",
        regionCode: "TX",
        country: "United States",
        countryCode: "US",
        postalCode: "75201",
        latitude: 32.77,
        longitude: -96.8,
        precision: "rooftop",
        validationSource: "address-validation",
      },
    ]);

    const results = await searchCustomerSiteAddresses("123 Main");

    expect(searchValidatedSiteAddresses).toHaveBeenCalledWith("123 Main");
    expect(results).toHaveLength(1);
    expect(results[0]?.providerRef).toBe("provider-ref-1");
  });
});

describe("createCustomerSite", () => {
  it("rejects blank site names", async () => {
    await expect(
      createCustomerSite({
        accountId: "acct-1",
        name: "   ",
        validatedAddressRef: "provider-ref-1",
      }),
    ).rejects.toThrow(/site name/i);

    expect(prisma.customerSite.create).not.toHaveBeenCalled();
  });

  it("rejects site creation when no validated address reference is provided", async () => {
    await expect(
      createCustomerSite({
        accountId: "acct-1",
        name: "Dallas HQ",
      }),
    ).rejects.toThrow(/validated address/i);
  });

  it("creates a site with a server-resolved validated address and revalidates customer views", async () => {
    vi.mocked(resolveValidatedSiteAddress).mockResolvedValue({
      providerRef: "provider-ref-1",
      label: "123 Main St, Dallas, Texas 75201, United States",
      addressLine1: "123 Main St",
      addressLine2: null,
      city: "Dallas",
      region: "Texas",
      regionCode: "TX",
      country: "United States",
      countryCode: "US",
      postalCode: "75201",
      latitude: 32.77,
      longitude: -96.8,
      precision: "rooftop",
      validationSource: "address-validation",
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        country: {
          findFirst: vi.fn().mockResolvedValue({
            id: "country-1",
            name: "United States",
            iso2: "US",
          }),
        },
        region: {
          findFirst: vi.fn().mockResolvedValue({
            id: "region-1",
            name: "Texas",
            code: "TX",
          }),
          create: vi.fn(),
        },
        city: {
          findFirst: vi.fn().mockResolvedValue({
            id: "city-1",
            name: "Dallas",
          }),
          create: vi.fn(),
        },
        address: {
          create: vi.fn().mockResolvedValue({
            id: "address-1",
          }),
        },
        customerSite: {
          create: vi.fn().mockResolvedValue({
            id: "site-1",
            siteId: "SITE-ABC12345",
            accountId: "acct-1",
            name: "Dallas HQ",
            siteType: "office",
            status: "active",
            timezone: "America/Chicago",
            accessInstructions: "Check in at reception.",
            hoursNotes: "Managed weekdays only.",
            serviceNotes: "Primary MSP site",
            primaryAddressId: "address-1",
          }),
        },
      };

      return callback(tx);
    });

    const site = await createCustomerSite({
      accountId: "acct-1",
      name: " Dallas HQ ",
      validatedAddressRef: "provider-ref-1",
      siteType: "office",
      status: "active",
      timezone: "America/Chicago",
      accessInstructions: "Check in at reception.",
      hoursNotes: "Managed weekdays only.",
      serviceNotes: "Primary MSP site",
    });

    expect(site.name).toBe("Dallas HQ");
    expect(resolveValidatedSiteAddress).toHaveBeenCalledWith("provider-ref-1");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/customer");
    expect(revalidatePath).toHaveBeenCalledWith("/customer/acct-1");
  });
});

describe("createCustomerSiteNode", () => {
  it("rejects blank node names", async () => {
    await expect(
      createCustomerSiteNode({
        accountId: "acct-1",
        siteId: "site-1",
        name: "   ",
      }),
    ).rejects.toThrow(/node name/i);

    expect(prisma.customerSiteNode.create).not.toHaveBeenCalled();
  });

  it("creates a child node under a site and revalidates the account detail page", async () => {
    vi.mocked(prisma.customerSiteNode.create).mockResolvedValue({
      id: "node-1",
      nodeId: "SITE-NODE-ABC12345",
      siteId: "site-1",
      parentNodeId: "node-parent-1",
      name: "Server Room",
      nodeType: "room",
      status: "active",
      notes: "Badge required.",
    } as never);

    const node = await createCustomerSiteNode({
      accountId: "acct-1",
      siteId: "site-1",
      parentNodeId: "node-parent-1",
      name: " Server Room ",
      nodeType: "room",
      notes: "Badge required.",
    });

    expect(node.name).toBe("Server Room");
    expect(prisma.customerSiteNode.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        siteId: "site-1",
        parentNodeId: "node-parent-1",
        name: "Server Room",
        nodeType: "room",
        notes: "Badge required.",
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/customer/acct-1");
  });
});

describe("createCustomerConfigurationItem", () => {
  it("rejects blank configuration item names", async () => {
    await expect(
      createCustomerConfigurationItem({
        accountId: "acct-1",
        ciType: "endpoint_protection",
        name: "   ",
      }),
    ).rejects.toThrow(/configuration item name/i);

    expect(prisma.customerConfigurationItem.create).not.toHaveBeenCalled();
  });

  it("creates a configuration item and revalidates customer views", async () => {
    vi.mocked(prisma.customerConfigurationItem.create).mockResolvedValue({
      id: "cci-1",
      customerCiId: "CCI-ABC12345",
      accountId: "acct-1",
      siteId: "site-1",
      name: "SentinelOne Complete",
      ciType: "endpoint-security-license",
      lifecycleStatus: "renew",
      supportStatus: "supported",
      recommendedAction: "renew",
    } as never);

    const item = await createCustomerConfigurationItem({
      accountId: "acct-1",
      siteId: "site-1",
      name: " SentinelOne Complete ",
      ciType: "endpoint-security-license",
      technologySourceType: "commercial",
      normalizedVersion: "24.1",
      billingCadence: "annual",
      customerChargeModel: "pass_through",
      renewalDate: "2026-06-01",
      licenseQuantity: 25,
      reviewCadenceDays: 30,
    });

    expect(item.name).toBe("SentinelOne Complete");
    expect(prisma.customerConfigurationItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accountId: "acct-1",
        siteId: "site-1",
        name: "SentinelOne Complete",
        ciType: "endpoint-security-license",
        technologySourceType: "commercial",
        normalizedVersion: "24.1",
        billingCadence: "annual",
        customerChargeModel: "pass_through",
        licenseQuantity: 25,
        lifecycleStatus: "renew",
        supportStatus: "supported",
        recommendedAction: "renew",
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/customer");
    expect(revalidatePath).toHaveBeenCalledWith("/customer/acct-1");
  });
});
