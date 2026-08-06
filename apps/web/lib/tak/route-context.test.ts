import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPrisma,
  mockGetPlaybook,
  mockGetVocabulary,
  mockResolveOrgProfileId,
  mockGetSelfUpgradeConfig,
} = vi.hoisted(() => ({
  mockPrisma: {
    organization: { findFirst: vi.fn() },
    decisionInteraction: { count: vi.fn(), findMany: vi.fn() },
    decisionPerspectiveProfile: { count: vi.fn() },
    wikiPage: { count: vi.fn() },
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
    runtimeTarget: { findMany: vi.fn() },
    nonProductionEnvironmentLease: { findMany: vi.fn() },
    platformConfig: { findUnique: vi.fn() },
    selfUpgradeRun: { findFirst: vi.fn() },
  },
  mockGetPlaybook: vi.fn(),
  mockGetVocabulary: vi.fn(),
  mockResolveOrgProfileId: vi.fn(),
  mockGetSelfUpgradeConfig: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ Prisma: { DbNull: "DbNull" }, prisma: mockPrisma }));
vi.mock("@/lib/tak/marketing-playbooks", () => ({ getPlaybook: mockGetPlaybook }));
vi.mock("@/lib/storefront/archetype-vocabulary", () => ({ getVocabulary: mockGetVocabulary }));
vi.mock("@/lib/decision-perspective/material", () => ({ resolveOrgProfileId: mockResolveOrgProfileId }));
// getSelfUpgradeContext reads self-upgrade config directly (boundary-legal;
// tak may not import the actions/queue contexts). Mock the config loader; the
// job-engine + run signals come from the mocked prisma above.
vi.mock("@/lib/self-upgrade/config", () => ({ getSelfUpgradeConfig: mockGetSelfUpgradeConfig }));

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
  mockResolveOrgProfileId.mockReset();
  mockPrisma.organization.findFirst.mockReset();
  mockPrisma.decisionInteraction.count.mockReset();
  mockPrisma.decisionInteraction.findMany.mockReset();
  mockPrisma.decisionPerspectiveProfile.count.mockReset();
  mockPrisma.wikiPage.count.mockReset();
  mockPrisma.organization.findFirst.mockResolvedValue({ id: "org-1" });
  mockResolveOrgProfileId.mockResolvedValue(null);
  mockPrisma.decisionInteraction.count.mockResolvedValue(0);
  mockPrisma.decisionInteraction.findMany.mockResolvedValue([]);
  mockPrisma.decisionPerspectiveProfile.count.mockResolvedValue(0);
  mockPrisma.wikiPage.count.mockResolvedValue(0);

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
  mockPrisma.runtimeTarget.findMany.mockReset();
  mockPrisma.nonProductionEnvironmentLease.findMany.mockReset();
  mockPrisma.runtimeTarget.findMany.mockResolvedValue([]);
  mockPrisma.nonProductionEnvironmentLease.findMany.mockResolvedValue([]);
  mockPrisma.platformConfig.findUnique.mockReset();
  mockPrisma.selfUpgradeRun.findFirst.mockReset();
  mockPrisma.platformConfig.findUnique.mockResolvedValue(null);
  mockPrisma.selfUpgradeRun.findFirst.mockResolvedValue(null);
  mockGetSelfUpgradeConfig.mockReset();
  mockGetSelfUpgradeConfig.mockResolvedValue({ enabled: true, channel: "stable" });

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

  it("gives /ops/dev-loop its own runtime-coordination page data, not the backlog (BI-FD7E4D72)", async () => {
    const now = Date.now();
    mockPrisma.runtimeTarget.findMany.mockResolvedValue([
      {
        targetId: "RT-ROOT-PORTAL",
        kind: "root-portal",
        status: "running",
        hostUrl: "http://localhost:3000",
        lastHeartbeatAt: new Date(now - 5 * 60_000),
        expiresAt: null,
        updatedAt: new Date(now - 5 * 60_000),
        workCapsule: null,
        featureBuild: null,
      },
      {
        targetId: "RT-BUILD-SANDBOX-9E4FA6DE",
        kind: "build-sandbox",
        status: "running",
        hostUrl: "http://localhost:3035",
        // stale: heartbeat is days old, janitor should have swept it
        lastHeartbeatAt: new Date(now - 11 * 24 * 3_600_000),
        expiresAt: null,
        updatedAt: new Date(now - 11 * 24 * 3_600_000),
        workCapsule: { headBranch: "fix/some-branch" },
        featureBuild: { buildId: "FB-12345678" },
      },
    ]);
    mockPrisma.nonProductionEnvironmentLease.findMany.mockResolvedValue([
      {
        leaseId: "LEASE-1",
        environmentKey: "local-integration-ci",
        status: "active",
        ownerProvider: "codex",
        purpose: "Validate self-upgrade backup script path repair",
        branchName: "fix/self-upgrade-backup-script-path",
        worktreePath: "/work/abc",
        expiresAt: new Date(now + 3 * 3_600_000),
        releasedAt: null,
      },
    ]);

    const context = await getRouteDataContext("/ops/dev-loop", "user-1");

    expect(context).toContain("PAGE DATA — Dev Loop (runtime coordination map):");
    // The runtime targets the page renders must be present...
    expect(context).toContain("RT-ROOT-PORTAL");
    expect(context).toContain("RT-BUILD-SANDBOX-9E4FA6DE");
    expect(context).toContain("ACTIVE RUNTIME TARGETS (2)");
    expect(context).toContain("ACTIVE NON-PROD LEASES (1)");
    expect(context).toContain("local-integration-ci");
    // ...and it must explain stale-vs-live + same-port duplicates (the operator's question).
    expect(context).toContain("no heartbeat for 2h");
    expect(context).toMatch(/lastHeartbeat=.*h ago/);
    // It must NOT have fallen back to the /ops backlog provider.
    expect(context).not.toContain("PAGE DATA — Operations Backlog:");
    expect(mockPrisma.runtimeTarget.findMany).toHaveBeenCalled();
  });

  it("gives /ops/self-upgrade its own self-upgrade + job-engine page data, not the backlog", async () => {
    // Reproduces the reported incident: on /ops/self-upgrade a coworker asked
    // "what's this background job issue?" and answered with backlog items +
    // epics because the route fell through to the /ops backlog provider.
    const now = Date.now();
    mockGetSelfUpgradeConfig.mockResolvedValue({ enabled: true, channel: "stable" });
    mockPrisma.selfUpgradeRun.findFirst.mockResolvedValue({
      runId: "SU-af60461f8",
      status: "succeeded",
      trigger: "scheduled",
      targetSha: "af60461f8abc1234",
      deployedSha: "af60461f8abc1234",
      createdAt: new Date(now - 3 * 3_600_000),
      completedAt: new Date(now - 3 * 3_600_000 + 5 * 60_000),
    });
    mockPrisma.platformConfig.findUnique.mockImplementation(async (args: { where: { key: string } }) => {
      if (args.where.key === "ops.jobEngine.inngestRegistration") {
        return {
          key: args.where.key,
          value: { ok: true, at: new Date(now - 80 * 60_000).toISOString(), error: null },
        };
      }
      if (args.where.key === "ops.jobEngine.inngestWatchdog") {
        return {
          key: args.where.key,
          value: {
            // Healthy registration but no POST execution for ~72 min = starved.
            lastInvocationAt: new Date(now - 72 * 60_000).toISOString(),
            lastGatewayHitAt: new Date(now - 72 * 60_000).toISOString(),
            lastRecoveryAttemptAt: new Date(now - 25 * 60_000).toISOString(),
            lastRecoverySummary: "retention sweep ran, orphansReaped=0, historyTrimmed=1899, errors=0",
          },
        };
      }
      return null;
    });

    const context = await getRouteDataContext("/ops/self-upgrade", "user-1");

    expect(context).toContain("PAGE DATA — Self-Upgrade (platform update status):");
    // The on-screen "Background jobs need attention" alert is the operator's question.
    expect(context).toContain("BACKGROUND JOBS");
    expect(context).toContain("Inngest registration: ok");
    expect(context).toContain("Last background-job execution (POST /api/inngest):");
    // Healthy registration + long execution gap must surface as degraded/starved.
    expect(context).toContain("LIKELY DEGRADED");
    expect(context).toContain("starved or wedged");
    expect(context).toContain("orphansReaped=0, historyTrimmed=1899");
    // Self-upgrade release status is present too.
    expect(context).toContain("Self-upgrade: enabled (channel: stable)");
    expect(context).toContain("SU-af60461f8");
    // It must NOT have fallen back to the /ops backlog provider.
    expect(context).not.toContain("PAGE DATA — Operations Backlog:");
    expect(mockGetSelfUpgradeConfig).toHaveBeenCalled();
    expect(mockPrisma.selfUpgradeRun.findFirst).toHaveBeenCalled();
  });

  it("gives /coworker-decisions the decision-governance open-review counts + named reviews, not a generic blurb (BI-C888E1B6)", async () => {
    mockPrisma.decisionInteraction.count.mockImplementation(async (args: {
      where: { profileId?: unknown };
    }) => {
      const { where } = args;
      const pid = where.profileId;
      const isWsid = typeof pid === "object" && pid !== null && "startsWith" in pid;
      const isWwmd = pid === "mark-dpf-platform";
      // 30-day decision counts
      if (isWwmd) return 46;
      if (isWsid) return 0;
      return 3;
    });
    mockPrisma.wikiPage.count.mockImplementation(async (args: { where: { pageKind?: string } }) =>
      args.where.pageKind === "principle" ? 158 : 33,
    );
    mockPrisma.decisionPerspectiveProfile.count.mockResolvedValue(23);
    const review = (interactionId: string, profileId: string, question = `Review ${interactionId}`) => ({
      interactionId,
      question,
      options: [{ id: "migrate" }, { id: "feature" }],
      outcomeType: "escalate",
      outcomePayload: { unresolvedReason: "principle-gap" },
      buildId: null,
      taskRunId: null,
      routeContext: "/build",
      domainClass: "architecture",
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      profile: { profileId, name: "WWMD Platform", kind: "platform" },
    });
    mockPrisma.decisionInteraction.findMany.mockImplementation(async (args: {
      where: { profileId?: unknown };
      take?: number;
    }) => {
      if (args.take === 8) {
        return [
          review(
            "DI-ABC123",
            "mark-dpf-platform",
            "Should we prioritize the migration or the new feature?",
          ),
        ];
      }
      const pid = args.where.profileId;
      if (pid === "mark-dpf-platform") {
        return Array.from({ length: 17 }, (_, i) => review(`DI-WWMD-${i}`, "mark-dpf-platform"));
      }
      if (typeof pid === "object" && pid !== null && "startsWith" in pid) {
        return [];
      }
      return [review("DI-WWWD-1", "wwd-org")];
    });

    const context = await getRouteDataContext("/coworker-decisions", "user-1");

    expect(context).toContain("PAGE DATA — Decision Governance (/coworker-decisions):");
    expect(context).toContain("OPEN REVIEWS awaiting a human: 18 total");
    expect(context).toContain("WWMD (platform): 17 open reviews");
    expect(context).toContain("WWWD (business): 1 open review");
    expect(context).toContain("WSID (craft): 0 open reviews");
    expect(context).toContain("DECISIONS RECORDED (last 30 days): WWMD 46, WWWD 3, WSID 0");
    expect(context).toContain("158 kernel principles, 33 heuristics, 23 active role families");
    // The coworker can now NAME a specific review and deep-link it — no "paste the screen".
    expect(context).toContain("Should we prioritize the migration or the new feature?");
    expect(context).toContain("/platform/ai/decisions/DI-ABC123");
    expect(context).toContain("list_open_decision_reviews");
  });

  it("gives an unenrolled route a default page-identity block instead of leaving the coworker blind (BI-F2AFD796)", async () => {
    // /admin/backups has no bespoke provider — before the default provider it
    // returned only the generic business blurb, so the coworker could not name it.
    const context = await getRouteDataContext("/admin/backups", "user-1");

    expect(context).toContain("PAGE DATA — Admin › Backups:");
    expect(context).toContain("route /admin/backups");
    expect(context).toMatch(/rather than asking the user to paste/i);
    // It must NOT have matched a bespoke provider.
    expect(context).not.toContain("PAGE DATA — Operations Backlog:");
  });

  it("humanizes a dynamic segment as Detail", async () => {
    const context = await getRouteDataContext("/some/unmapped/[entryId]", "user-1");
    expect(context).toContain("PAGE DATA — Some › Unmapped › Detail:");
  });

  it("never leaves a coworker fully blind — returns page identity even with no business context", async () => {
    mockPrisma.businessContext.findFirst.mockResolvedValue(null);
    const context = await getRouteDataContext("/admin/scheduled-jobs", "user-1");
    expect(context).not.toBeNull();
    expect(context).toContain("PAGE DATA — Admin › Scheduled Jobs:");
  });
});
