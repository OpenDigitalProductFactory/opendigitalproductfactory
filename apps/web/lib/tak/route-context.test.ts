import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  mockGetPlaybook,
  mockGetVocabulary,
} = vi.hoisted(() => ({
  mockPrisma: {
    businessContext: { findFirst: vi.fn() },
    storefrontConfig: { findFirst: vi.fn() },
    storefrontBooking: { count: vi.fn() },
    storefrontInquiry: { count: vi.fn() },
    storefrontOrder: { count: vi.fn() },
    storefrontDonation: { count: vi.fn() },
    engagement: { groupBy: vi.fn() },
    opportunity: { groupBy: vi.fn() },
  },
  mockGetPlaybook: vi.fn(),
  mockGetVocabulary: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/tak/marketing-playbooks", () => ({ getPlaybook: mockGetPlaybook }));
vi.mock("@/lib/storefront/archetype-vocabulary", () => ({ getVocabulary: mockGetVocabulary }));

import { getRouteDataContext } from "./route-context";

beforeEach(() => {
  mockPrisma.businessContext.findFirst.mockReset();
  mockPrisma.storefrontConfig.findFirst.mockReset();
  mockPrisma.storefrontBooking.count.mockReset();
  mockPrisma.storefrontInquiry.count.mockReset();
  mockPrisma.storefrontOrder.count.mockReset();
  mockPrisma.storefrontDonation.count.mockReset();
  mockPrisma.engagement.groupBy.mockReset();
  mockPrisma.opportunity.groupBy.mockReset();
  mockGetPlaybook.mockReset();
  mockGetVocabulary.mockReset();

  mockPrisma.businessContext.findFirst.mockResolvedValue({
    industry: "professional-services",
    description: "Managed IT and support",
    targetMarket: "SMB customers",
    revenueModel: "Managed service agreements with recurring schedules and customer-estate coverage",
    ctaType: "inquiry",
    companySize: null,
    geographicScope: null,
  });

  mockPrisma.storefrontConfig.findFirst.mockResolvedValue({
    id: "sf-1",
    archetype: {
      archetypeId: "it-managed-services",
      name: "IT Managed Services",
      category: "professional-services",
      ctaType: "inquiry",
      customVocabulary: null,
      activationProfile: {
        profileType: "managed-service-provider",
        modules: ["customer-estate", "service-agreements", "service-operations"],
        billingReadinessMode: "prepared-not-prescribed",
        customerGraph: "separate-customer-projection",
        estateSeparation: "strict",
      },
    },
  });

  mockPrisma.storefrontBooking.count.mockResolvedValue(0);
  mockPrisma.storefrontInquiry.count.mockResolvedValue(4);
  mockPrisma.storefrontOrder.count.mockResolvedValue(0);
  mockPrisma.storefrontDonation.count.mockResolvedValue(0);
  mockPrisma.engagement.groupBy.mockResolvedValue([]);
  mockPrisma.opportunity.groupBy.mockResolvedValue([]);

  mockGetPlaybook.mockReturnValue({
    primaryGoal: "Build authority pipeline through expertise demonstration and client nurture",
    stakeholders: "Clients, prospects, referral partners, industry contacts",
    campaignTypes: ["Thought leadership"],
    contentTone: "Authoritative",
    keyMetrics: ["Inquiry-to-engagement conversion rate"],
    ctaLanguage: ["Request a proposal"],
    agentSkills: ["Client retention review"],
  });

  mockGetVocabulary.mockReturnValue({
    itemsLabel: "Services",
    singleItemLabel: "Service",
    addButtonLabel: "Add service",
    categoryLabel: "Practice Area",
    priceLabel: "Fee",
    portalLabel: "Client Portal",
    stakeholderLabel: "Clients",
    teamLabel: "Team",
    inboxLabel: "Enquiries",
    agentName: "Client Engagement",
  });
});

describe("getRouteDataContext", () => {
  it("includes MSP operating profile details for storefront routes", async () => {
    const context = await getRouteDataContext("/storefront", "user-1");

    expect(context).toContain("PAGE DATA — Client Portal:");
    expect(context).toContain("Archetype activation: managed-service-provider");
    expect(context).toContain("Operating modules: customer-estate, service-agreements, service-operations");
    expect(context).toContain("Billing mode: prepared-not-prescribed");
    expect(context).toContain("Customer graph: separate-customer-projection");
    expect(context).toContain("Estate separation: strict");
  });
});
