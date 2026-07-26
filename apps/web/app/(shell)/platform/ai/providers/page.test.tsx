import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({
    user: { platformRole: "admin", isSuperuser: true },
  }),
}));

vi.mock("@/lib/permissions", () => ({
  can: vi.fn().mockReturnValue(true),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    scheduledJob: {
      findMany: vi.fn().mockResolvedValue([
        {
          jobId: "provider-registry-sync",
          schedule: "daily",
          lastRunAt: new Date("2026-06-28T12:00:00.000Z"),
          nextRunAt: new Date("2099-01-01T00:00:00.000Z"),
          lastStatus: "ok",
          lastError: null,
        },
      ]),
      update: vi.fn(),
    },
    modelProvider: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ai-provider-data", () => ({
  getProviders: vi.fn().mockResolvedValue([]),
  getTokenSpendByProvider: vi.fn().mockResolvedValue([]),
  getTokenSpendByAgent: vi.fn().mockResolvedValue([]),
  getScheduledJobs: vi.fn().mockResolvedValue([
    {
      jobId: "provider-registry-sync",
      schedule: "daily",
      lastRunAt: new Date("2026-06-28T12:00:00.000Z"),
      nextRunAt: new Date("2099-01-01T00:00:00.000Z"),
      lastStatus: "ok",
      lastError: null,
    },
  ]),
  groupByEndpointTypeAndCategory: vi.fn().mockReturnValue([]),
  getProviderModelSummaries: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("@/lib/actions/ai-providers", () => ({
  syncProviderRegistry: vi.fn(),
  detectMcpServers: vi.fn().mockResolvedValue([]),
  runProviderCatalogReconciliationIfDue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/actions/route-decision-logs", () => ({
  getProviderSuitabilityTelemetryRollup: vi.fn().mockResolvedValue({
    totalRequests: 0,
    selectedRoutes: 0,
    successes: 0,
    failures: 0,
    exclusions: 0,
    byProvider: {},
    byModel: {},
    byActivityClass: {},
    byWorkloadClass: {},
    suppressedWorkloadClasses: [],
    minimumCohortSize: 5,
  }),
}));

vi.mock("@/lib/ollama", () => ({
  checkBundledProviders: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/routing/provider-suitability/provider-onboarding-data", () => ({
  loadProviderOnboardingRecommendation: vi.fn().mockResolvedValue({
    status: "review-needed",
    headline: "Keep company data out until account terms are confirmed",
    useNow: [],
    useAfterReview: [],
    notForThisWork: [],
    whatMayLeave: "Public prompts",
    whatStaysLocal: "Secrets",
    whatDpfBlocks: "Company data",
    nextAction: "Choose a business account.",
    caveat: "Local is not automatically compliant.",
    workloadClasses: ["public-marketing"],
    reviewPacket: {
      schemaVersion: "provider-compliance-review.v1",
      purpose: "provider-suitability-advice",
      organizationRef: "org-test",
      businessContext: {
        archetypeId: null,
        archetypeCategory: null,
        jurisdictionBasis: { operatesIn: [], sellsTo: [], employsIn: [], dataResidency: [] },
        riskPosture: null,
      },
      recommendation: { status: "review-needed", workloadClasses: ["public-marketing"] },
      providerConnections: [],
      requestedAdvisory: [
        "regulatory-applicability",
        "account-and-contract-evidence",
        "retention-and-training-treatment",
        "processing-region-and-sovereignty",
        "workload-restrictions",
        "safe-next-action",
      ],
    },
  }),
}));

vi.mock("@/components/platform/DetectedServicesBanner", () => ({
  DetectedServicesBanner: () => <div>detected-services-banner</div>,
}));

vi.mock("@/components/platform/TokenSpendPanel", () => ({
  TokenSpendPanel: () => <div>token-spend-panel</div>,
}));

vi.mock("@/components/platform/ScheduledJobsTable", () => ({
  ScheduledJobsTable: () => <div>scheduled-jobs-table</div>,
}));

vi.mock("@/components/platform/ServiceSection", () => ({
  ServiceSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/platform/ServiceRow", () => ({
  ServiceRow: () => <div>service-row</div>,
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe("ProvidersPage", () => {
  it("renders provider and routing content without MCP service operations or tool inventory", async () => {
    const { default: ProvidersPage } = await import("./page");
    const html = renderToStaticMarkup(await ProvidersPage());

    expect(html).toContain("Providers &amp; Routing");
    expect(html).toContain("AI provider setup");
    expect(html).toContain("Keep company data out until account terms are confirmed");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Recommendation summary"');
    expect(html).toContain("Review provider choices");
    expect(html).toContain("Your COO will give one short next step");
    expect(html).toContain("Next action: Choose a business account.");
    expect(html).toContain("detected-services-banner");
    expect(html).toContain("Advanced routing operations");
    expect(html).toContain("token-spend-panel");
    expect(html).toContain("scheduled-jobs-table");
    expect(html).not.toContain("Activated MCP Services");
    expect(html).not.toContain("Tool Inventory");
    expect(html).toContain('href="/platform/ai/readiness"');
    expect(html).toContain('href="/platform/tools/services"');
  });

  it("shows provider catalog freshness without a normal-path refresh action", async () => {
    const { default: ProvidersPage } = await import("./page");
    const html = renderToStaticMarkup(await ProvidersPage());

    expect(html).toContain("Provider catalog");
    expect(html).toContain("Last updated");
    expect(html).not.toContain("Refresh Provider Catalog");
    expect(html).not.toContain("Sync Provider Registry");
  });
});
