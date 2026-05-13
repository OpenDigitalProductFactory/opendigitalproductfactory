import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  mockGetPlaybook,
  mockGetVocabulary,
} = vi.hoisted(() => ({
  mockPrisma: {
    businessContext: { findFirst: vi.fn() },
    storefrontConfig: { findFirst: vi.fn() },
    organizationLicenseProfile: { findFirst: vi.fn() },
    organizationLicenseRecord: { count: vi.fn() },
    personLicenseRecord: { count: vi.fn() },
    licenseReadinessIssue: { count: vi.fn() },
    licenseRequirementReference: { findMany: vi.fn() },
    storefrontBooking: { count: vi.fn() },
    storefrontInquiry: { count: vi.fn() },
    storefrontOrder: { count: vi.fn() },
    storefrontDonation: { count: vi.fn() },
    engagement: { groupBy: vi.fn() },
    opportunity: { groupBy: vi.fn() },
    organizationTaxProfile: { findFirst: vi.fn() },
    taxRegistration: { count: vi.fn(), findMany: vi.fn() },
    taxIssue: { count: vi.fn(), findMany: vi.fn() },
    recurringSchedule: { count: vi.fn() },
    invoice: { count: vi.fn() },
    taxAuthorityCredential: { count: vi.fn() },
    taxRemittanceRun: { count: vi.fn() },
    taxObligationPeriod: { count: vi.fn() },
    taxJurisdictionReference: { findMany: vi.fn() },
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
  mockPrisma.organizationLicenseProfile.findFirst.mockReset();
  mockPrisma.organizationLicenseRecord.count.mockReset();
  mockPrisma.personLicenseRecord.count.mockReset();
  mockPrisma.licenseReadinessIssue.count.mockReset();
  mockPrisma.licenseRequirementReference.findMany.mockReset();
  mockPrisma.storefrontBooking.count.mockReset();
  mockPrisma.storefrontInquiry.count.mockReset();
  mockPrisma.storefrontOrder.count.mockReset();
  mockPrisma.storefrontDonation.count.mockReset();
  mockPrisma.engagement.groupBy.mockReset();
  mockPrisma.opportunity.groupBy.mockReset();
  mockPrisma.organizationTaxProfile.findFirst.mockReset();
  mockPrisma.taxRegistration.count.mockReset();
  mockPrisma.taxRegistration.findMany.mockReset();
  mockPrisma.taxIssue.count.mockReset();
  mockPrisma.taxIssue.findMany.mockReset();
  mockPrisma.recurringSchedule.count.mockReset();
  mockPrisma.invoice.count.mockReset();
  mockPrisma.taxAuthorityCredential.count.mockReset();
  mockPrisma.taxRemittanceRun.count.mockReset();
  mockPrisma.taxObligationPeriod.count.mockReset();
  mockPrisma.taxJurisdictionReference.findMany.mockReset();
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

  mockPrisma.organizationLicenseProfile.findFirst.mockResolvedValue({
    id: "profile-1",
    setupStatus: "investigating",
    investigationMode: "expanding",
    homeCountryCode: "US",
    primaryRegionCode: "NV",
    legalActivityConfidence: "medium",
    researchCoverageStatus: "partial",
  });
  mockPrisma.organizationLicenseRecord.count.mockResolvedValue(2);
  mockPrisma.personLicenseRecord.count.mockResolvedValue(1);
  mockPrisma.licenseReadinessIssue.count.mockResolvedValue(3);
  mockPrisma.licenseRequirementReference.findMany.mockResolvedValue([
    {
      authorityName: "Nevada State Contractors Board",
      jurisdictionLabel: "Nevada",
      requirementType: "license",
      scopeLevel: "organization",
    },
    {
      authorityName: "Clark County Business License Department",
      jurisdictionLabel: "Clark County",
      requirementType: "permit",
      scopeLevel: "premises",
    },
  ]);

  mockPrisma.storefrontBooking.count.mockResolvedValue(0);
  mockPrisma.storefrontInquiry.count.mockResolvedValue(4);
  mockPrisma.storefrontOrder.count.mockResolvedValue(0);
  mockPrisma.storefrontDonation.count.mockResolvedValue(0);
  mockPrisma.engagement.groupBy.mockResolvedValue([]);
  mockPrisma.opportunity.groupBy.mockResolvedValue([]);

  mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue(null);
  mockPrisma.taxRegistration.count.mockResolvedValue(0);
  mockPrisma.taxRegistration.findMany.mockResolvedValue([]);
  mockPrisma.taxIssue.count.mockResolvedValue(0);
  mockPrisma.taxIssue.findMany.mockResolvedValue([]);
  mockPrisma.recurringSchedule.count.mockResolvedValue(0);
  mockPrisma.invoice.count.mockResolvedValue(0);
  mockPrisma.taxAuthorityCredential.count.mockResolvedValue(0);
  mockPrisma.taxRemittanceRun.count.mockResolvedValue(0);
  mockPrisma.taxObligationPeriod.count.mockResolvedValue(0);
  mockPrisma.taxJurisdictionReference.findMany.mockResolvedValue([]);

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

  it("includes archetype and licensing readiness details for /compliance/licensing", async () => {
    const context = await getRouteDataContext("/compliance/licensing", "user-1");

    expect(context).toContain("PAGE DATA — Licensing Readiness:");
    expect(context).toContain("Business archetype: IT Managed Services");
    expect(context).toContain("Investigation mode: expanding");
    expect(context).toContain("Requirement reference hints:");
    expect(context).toContain("Nevada State Contractors Board");
  });

  it("includes tax coworker investigation guidance and jurisdiction hints for finance tax setup", async () => {
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue({
      setupMode: "new_business",
      setupStatus: "draft",
      homeCountryCode: "US",
      primaryRegionCode: "NV",
      taxModel: "hybrid",
      filingOwner: "dpf_coworker",
      handoffMode: "dpf_readiness_only",
      externalSystem: null,
      footprintSummary: "Nevada services and possible local customer sites.",
    });
    mockPrisma.taxRegistration.count.mockResolvedValue(0);
    mockPrisma.taxIssue.count.mockResolvedValue(2);
    mockPrisma.taxIssue.findMany.mockResolvedValue([
      {
        title: "Tax authority research is still needed",
        severity: "high",
        issueType: "tax_registration_research_needed",
      },
    ]);
    mockPrisma.taxJurisdictionReference.findMany.mockResolvedValue([
      {
        authorityName: "Nevada Department of Taxation",
        countryCode: "US",
        stateProvinceCode: "NV",
        authorityType: "state",
        taxTypes: ["sales_tax"],
        filingUrl: "https://tax.nv.gov/",
        officialWebsiteUrl: "https://tax.nv.gov/",
      },
    ]);

    const context = await getRouteDataContext("/finance/settings/tax", "user-1");

    expect(context).toContain("PAGE DATA — Finance:");
    expect(context).toContain("Coworker investigation posture: first-time setup");
    expect(context).toContain("Coworker next question: Where is the business legally registered and where are taxable services delivered?");
    expect(context).toContain("Recommended next action: Research likely authorities from the seeded jurisdiction registry, then live-verify official sources before scheduling periods.");
    expect(context).toContain("Top open tax issue: high tax_registration_research_needed - Tax authority research is still needed");
    expect(context).toContain("Jurisdiction seed hints:");
    expect(context).toContain("Nevada Department of Taxation");
  });

  it("tells the finance coworker to research official sources and propose DPF tax processing for Texas software sales", async () => {
    mockPrisma.businessContext.findFirst.mockResolvedValue({
      industry: "software-platform",
      description: "Open Digital Product Factory sells DPF subscriptions and implementation services.",
      targetMarket: "Texas businesses buying DPF",
      revenueModel: "Software subscription billing and implementation services",
      ctaType: "inquiry",
      companySize: null,
      geographicScope: "Texas, United States",
    });
    mockPrisma.organizationTaxProfile.findFirst.mockResolvedValue({
      setupMode: "unknown",
      setupStatus: "draft",
      homeCountryCode: "US",
      primaryRegionCode: "TX",
      taxModel: "hybrid",
      filingOwner: "dpf_coworker",
      handoffMode: "dpf_readiness_only",
      externalSystem: null,
      footprintSummary: "DPF selling DPF in Texas with recurring software subscriptions.",
    });
    mockPrisma.taxJurisdictionReference.findMany.mockResolvedValue([
      {
        authorityName: "Texas Comptroller of Public Accounts",
        countryCode: "US",
        stateProvinceCode: "TX",
        authorityType: "state",
        taxTypes: ["sales_tax", "franchise_tax"],
        filingUrl: "https://comptroller.texas.gov/taxes/",
        officialWebsiteUrl: "https://comptroller.texas.gov/",
      },
    ]);

    const context = await getRouteDataContext("/finance/settings/tax", "user-1");

    expect(context).toContain("External tax research requirement: External Access is required");
    expect(context).toContain("search_public_web");
    expect(context).toContain("fetch_public_website");
    expect(context).toContain("DPF tax processing proposal required");
    expect(context).toContain("Likely DPF/Texas research focus");
    expect(context).toContain("Texas Comptroller");
  });
});
