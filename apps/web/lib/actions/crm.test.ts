import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
    $queryRawUnsafe: vi.fn(),
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
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
    },
    customerSiteNode: {
      create: vi.fn(),
    },
    customerContact: {
      findUnique: vi.fn(),
    },
    customerConfigurationItem: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    engagement: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    opportunity: {
      findUnique: vi.fn(),
      update: vi.fn(),
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
  updateCustomerSite,
  advanceOpportunityStage,
  updateOpportunityStageFromForm,
  updateCustomerConfigurationItem,
  routeAcquisitionSignalToEngagement,
  createEngagementFromSignalForm,
  createQuote,
} from "./crm";

beforeEach(() => {
  vi.clearAllMocks();
  // Dedup gate candidate fetch: default to "no similar rows".
  vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
});

describe("createQuote commercial lineage", () => {
  it("persists an exact catalog item and immutable one-off configuration snapshot", async () => {
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue({
      id: "opportunity-row",
      accountId: "account-row",
    } as never);
    vi.mocked(prisma.$queryRawUnsafe).mockResolvedValue([
      { nextval: 1n },
    ] as never);

    const quoteCreate = vi.fn().mockResolvedValue({
      quoteId: "QUO-1",
      quoteNumber: "QUO-2026-0001",
      currency: "USD",
      totalAmount: 125,
      accountId: "account-row",
      opportunityId: "opportunity-row",
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) =>
      callback({ quote: { create: quoteCreate } } as never),
    );
    vi.mocked(prisma.activity.create).mockResolvedValue({} as never);

    const snapshot = {
      capturedAt: "2026-07-28T12:00:00.000Z",
      selections: { room: "ballroom", layout: "banquet" },
    };
    await createQuote({
      opportunityId: "opportunity-row",
      validUntil: "2026-08-31",
      lineItems: [{
        catalogItemId: "catalog-row",
        configurationSnapshot: snapshot,
        description: "Private event",
        quantity: 1,
        unitPrice: 125,
      }],
    });

    expect(quoteCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lineItems: {
            create: [
              expect.objectContaining({
                productId: null,
                catalogItemId: "catalog-row",
                configurationSnapshot: snapshot,
              }),
            ],
          },
        }),
      }),
    );
  });
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

    const result = await createCustomerSite({
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

    if (result.outcome === "duplicates-found") throw new Error("unexpected duplicates");
    expect(result.outcome).toBe("created");
    expect(result.site.name).toBe("Dallas HQ");
    expect(resolveValidatedSiteAddress).toHaveBeenCalledWith("provider-ref-1");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/customer");
    expect(revalidatePath).toHaveBeenCalledWith("/customer/acct-1");
  });
});

describe("updateCustomerSite", () => {
  const existingSite = {
    id: "site-1",
    name: "Dallas HQ",
    siteType: "office",
    status: "active",
    timezone: "America/Chicago",
    accessInstructions: "Reception",
    hoursNotes: "Weekdays",
    serviceNotes: "Primary",
    primaryAddressId: "address-old",
  };

  it("rejects missing sites", async () => {
    vi.mocked(prisma.customerSite.findFirst).mockResolvedValue(null);
    await expect(
      updateCustomerSite({
        id: "missing",
        accountId: "acct-1",
        name: "Nope",
      }),
    ).rejects.toThrow(/not found/i);
  });

  it("requires a validated address when the site has none", async () => {
    vi.mocked(prisma.customerSite.findFirst).mockResolvedValue({
      ...existingSite,
      primaryAddressId: null,
    } as never);

    await expect(
      updateCustomerSite({
        id: "site-1",
        accountId: "acct-1",
        name: "Dallas HQ",
      }),
    ).rejects.toThrow(/validated address/i);
  });

  it("revalidates and refreshes primaryAddress when a new selection is provided", async () => {
    vi.mocked(prisma.customerSite.findFirst).mockResolvedValue(existingSite as never);
    vi.mocked(resolveValidatedSiteAddress).mockResolvedValue({
      providerRef: "provider-ref-2",
      label: "456 Oak Ave, Dallas, Texas 75202, United States",
      addressLine1: "456 Oak Ave",
      addressLine2: null,
      city: "Dallas",
      region: "Texas",
      regionCode: "TX",
      country: "United States",
      countryCode: "US",
      postalCode: "75202",
      latitude: 32.78,
      longitude: -96.81,
      precision: "rooftop",
      validationSource: "nominatim",
    });

    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        country: {
          findFirst: vi.fn().mockResolvedValue({ id: "country-1" }),
        },
        region: {
          findFirst: vi.fn().mockResolvedValue({ id: "region-1" }),
          create: vi.fn(),
        },
        city: {
          findFirst: vi.fn().mockResolvedValue({ id: "city-1" }),
          create: vi.fn(),
        },
        address: {
          create: vi.fn().mockResolvedValue({ id: "address-new" }),
        },
        customerSite: {
          update: vi.fn().mockResolvedValue({
            ...existingSite,
            name: "Dallas HQ Renamed",
            primaryAddressId: "address-new",
          }),
        },
      };
      return callback(tx);
    });

    const site = await updateCustomerSite({
      id: "site-1",
      accountId: "acct-1",
      name: "Dallas HQ Renamed",
      validatedAddressRef: "provider-ref-2",
    });

    expect(site.primaryAddressId).toBe("address-new");
    expect(resolveValidatedSiteAddress).toHaveBeenCalledWith("provider-ref-2");
    expect(revalidatePath).toHaveBeenCalledWith("/customer/acct-1");
  });

  it("allows metadata-only updates when a primary address already exists", async () => {
    vi.mocked(prisma.customerSite.findFirst).mockResolvedValue(existingSite as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback: any) => {
      const tx = {
        customerSite: {
          update: vi.fn().mockResolvedValue({
            ...existingSite,
            serviceNotes: "Updated note",
          }),
        },
      };
      return callback(tx);
    });

    const site = await updateCustomerSite({
      id: "site-1",
      accountId: "acct-1",
      serviceNotes: "Updated note",
    });

    expect(site.serviceNotes).toBe("Updated note");
    expect(resolveValidatedSiteAddress).not.toHaveBeenCalled();
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

describe("routeAcquisitionSignalToEngagement", () => {
  it("returns the existing engagement when source evidence was already routed", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue({
      id: "contact-1",
      accountId: "acct-1",
      email: "bea@example.com",
      firstName: "Bea",
      lastName: "Buyer",
    } as never);
    vi.mocked(prisma.engagement.findFirst).mockResolvedValue({
      id: "eng-1",
      engagementId: "ENG-1",
      title: "Website inquiry from Bea Buyer",
      status: "new",
      source: "web_inquiry",
      sourceRefId: "inq-1",
    } as never);

    const result = await routeAcquisitionSignalToEngagement({
      title: "Website inquiry from Bea Buyer",
      contactId: "contact-1",
      accountId: "acct-1",
      source: "web_inquiry",
      sourceRefId: "inq-1",
      notes: "Source: storefront inquiry",
    });

    expect(result).toEqual({
      status: "linked",
      engagementId: "eng-1",
      engagementTitle: "Website inquiry from Bea Buyer",
    });
    expect(prisma.engagement.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { source: "web_inquiry", sourceRefId: "inq-1" },
          {
            accountId: "acct-1",
            contactId: "contact-1",
            source: "web_inquiry",
            title: "Website inquiry from Bea Buyer",
          },
        ],
      },
      select: {
        id: true,
        title: true,
        status: true,
      },
    });
    expect(prisma.engagement.create).not.toHaveBeenCalled();
  });

  it("creates an engagement from an explicit signal routing form and revalidates CRM surfaces", async () => {
    vi.mocked(prisma.customerContact.findUnique).mockResolvedValue({
      id: "contact-1",
      accountId: "acct-1",
      email: "bea@example.com",
      firstName: "Bea",
      lastName: "Buyer",
    } as never);
    vi.mocked(prisma.engagement.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.engagement.create).mockResolvedValue({
      id: "eng-1",
      engagementId: "ENG-1",
      title: "Website inquiry from Bea Buyer",
      status: "new",
      source: "web_inquiry",
      sourceRefId: "inq-1",
      accountId: "acct-1",
      contactId: "contact-1",
    } as never);
    vi.mocked(prisma.activity.create).mockResolvedValue({ id: "act-1" } as never);

    const formData = new FormData();
    formData.set("title", " Website inquiry from Bea Buyer ");
    formData.set("contactId", "contact-1");
    formData.set("accountId", "acct-1");
    formData.set("source", "web_inquiry");
    formData.set("sourceRefId", "inq-1");
    formData.set("notes", " Source: storefront inquiry ");

    const result = await createEngagementFromSignalForm(formData);

    expect(result.status).toBe("created");
    expect(prisma.engagement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Website inquiry from Bea Buyer",
        status: "new",
        accountId: "acct-1",
        contactId: "contact-1",
        source: "web_inquiry",
        sourceRefId: "inq-1",
        notes: "Source: storefront inquiry",
      }),
      include: {
        contact: true,
        account: true,
        assignedTo: { select: { id: true, email: true } },
      },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/customer");
    expect(revalidatePath).toHaveBeenCalledWith("/customer/engagements");
    expect(revalidatePath).toHaveBeenCalledWith("/customer/marketing");
  });
});

describe("advanceOpportunityStage", () => {
  it("updates stage, records a status-change activity, and revalidates opportunity routes", async () => {
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue({
      id: "opp-1",
      title: "Modernize revenue workflow",
      stage: "proposal",
      probability: 70,
      accountId: "acct-1",
      contactId: "contact-1",
    } as never);
    vi.mocked(prisma.opportunity.update).mockResolvedValue({
      id: "opp-1",
      title: "Modernize revenue workflow",
      stage: "negotiation",
      probability: 80,
      accountId: "acct-1",
      contactId: "contact-1",
      activities: [],
    } as never);
    vi.mocked(prisma.activity.create).mockResolvedValue({ id: "act-1" } as never);

    const updated = await advanceOpportunityStage("opp-1", "negotiation", {
      probability: 80,
    });

    expect(updated.stage).toBe("negotiation");
    expect(prisma.opportunity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "opp-1" },
        data: expect.objectContaining({
          stage: "negotiation",
          stageChangedAt: expect.any(Date),
          isDormant: false,
        }),
      }),
    );
    expect(prisma.activity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "status_change",
        subject: "Opportunity stage: proposal -> negotiation (80%)",
        accountId: "acct-1",
        contactId: "contact-1",
        opportunityId: "opp-1",
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/customer/opportunities");
    expect(revalidatePath).toHaveBeenCalledWith("/customer/opportunities/opp-1");
  });

  it("supports stage updates from an explicit form action", async () => {
    vi.mocked(prisma.opportunity.findUnique).mockResolvedValue({
      id: "opp-1",
      title: "Modernize revenue workflow",
      stage: "discovery",
      probability: 40,
      accountId: "acct-1",
      contactId: null,
    } as never);
    vi.mocked(prisma.opportunity.update).mockResolvedValue({
      id: "opp-1",
      title: "Modernize revenue workflow",
      stage: "proposal",
      probability: 70,
      accountId: "acct-1",
      contactId: null,
      activities: [],
    } as never);

    const formData = new FormData();
    formData.set("opportunityId", "opp-1");
    formData.set("stage", "proposal");

    await updateOpportunityStageFromForm(formData);

    expect(prisma.opportunity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "opp-1" },
        data: expect.objectContaining({ stage: "proposal" }),
      }),
    );
  });
});

describe("updateCustomerConfigurationItem", () => {
  it("updates lifecycle evidence and recalculates support posture", async () => {
    vi.mocked(prisma.customerConfigurationItem.findUnique).mockResolvedValue({
      id: "cci-1",
      accountId: "acct-1",
      name: "Ubuntu Server",
      ciType: "linux-server",
      technologySourceType: "open_source",
      supportModel: null,
      manufacturer: null,
      observedVersion: null,
      normalizedVersion: null,
      billingCadence: null,
      customerChargeModel: null,
      renewalDate: null,
      endOfSupportAt: null,
      endOfLifeAt: null,
      warrantyEndAt: null,
      licenseQuantity: null,
      lifecycleEvidence: null,
    } as never);

    vi.mocked(prisma.customerConfigurationItem.update).mockResolvedValue({
      id: "cci-1",
      accountId: "acct-1",
      name: "Ubuntu Server",
      lifecycleStatus: "review",
      supportStatus: "approaching_end",
      recommendedAction: "upgrade",
    } as never);

    const item = await updateCustomerConfigurationItem({
      accountId: "acct-1",
      configurationItemId: "cci-1",
      name: "Ubuntu Server",
      ciType: "linux-server",
      supportModel: "lts",
      normalizedVersion: "22.04 LTS",
      // BI-435905C1: keep end-of-support ~60 days out RELATIVE to now, so it
      // stays inside evaluateTechnologyLifecycle's REVIEW_WINDOW_DAYS (120) band
      // ("approaching_end") no matter when CI runs. A hardcoded "2026-07-15"
      // silently flipped to "expired"/"upgrade_due" the moment the clock passed
      // it (2026-07-15T00:00 UTC), failing this test deterministically post-
      // midnight — a time-bomb, not a mock-bleed flake.
      endOfSupportAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      evidenceSource: "Ubuntu LTS release calendar",
      evidenceNotes: "Verified against vendor-supported LTS timeline.",
      reviewCadenceDays: 45,
    });

    expect(item.lifecycleStatus).toBe("review");
    expect(prisma.customerConfigurationItem.update).toHaveBeenCalledWith({
      where: { id: "cci-1" },
      data: expect.objectContaining({
        supportModel: "lts",
        normalizedVersion: "22.04 LTS",
        lifecycleStatus: "review",
        supportStatus: "approaching_end",
        recommendedAction: "upgrade",
        lifecycleEvidence: expect.objectContaining({
          source: "Ubuntu LTS release calendar",
          notes: "Verified against vendor-supported LTS timeline.",
          seededReviewCadenceDays: 45,
        }),
      }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/customer");
    expect(revalidatePath).toHaveBeenCalledWith("/customer/acct-1");
  });
});
